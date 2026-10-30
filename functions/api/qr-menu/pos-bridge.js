import {ensureOrders,response,bad,fail,clean} from './_lib/orders.js';
import {verifyPluginIngress} from '../plugin/_lib/ingest-auth.js';

const error=e=>bad(e.status||500,e.code||'QR_POS_BRIDGE_FAILED',e.status?e.message:'Ошибка обмена с кассой');
const iso=()=>new Date().toISOString();
async function authorize(request,env,body){
  const pluginId=clean(body.pluginId,128),departmentId=clean(body.departmentId,128);
  if(!pluginId||!departmentId)throw fail('BRIDGE_IDENTITY_REQUIRED','Требуются pluginId и departmentId',400);
  const secret=clean(env.QR_POS_BRIDGE_TOKEN,256);
  const supplied=clean(request.headers.get('X-QR-Bridge-Token'),256);
  if(!secret)throw fail('QR_BRIDGE_DISABLED','POS Bridge не активирован на сервере',503);
  const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const a=await hash(secret),b=await hash(supplied);
  if(!a.every((v,i)=>v===b[i]))throw fail('QR_BRIDGE_FORBIDDEN','Неверный ключ QR POS Bridge',401);
  await verifyPluginIngress(request,env,{pluginId,departmentId});
  return {pluginId,departmentId};
}
export async function onRequestOptions(){return new Response(null,{status:204})}
export async function onRequestPost({request,env}){
  try{
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=='object'||Array.isArray(body))throw fail('BAD_BODY','Неверный запрос');
    const identity=await authorize(request,env,body);
    await ensureOrders(env.DB);
    const action=clean(body.action,32);
    const t=iso();
    if(action==='hello'){
      // The diagnostic handshake proves HTTPS connectivity only. It must never
      // mark this POS ready for guest orders or allow pull/kitchen/fiscal operations.
      const canCreate=body.canCreateOrder===true;
      if(body.contractVersion!==1||typeof body.canCreateOrder!=='boolean'||
          typeof body.canAcknowledgeFiscal!=='boolean'||
          typeof body.canPrintKitchen!=='boolean'||
          body.canAcknowledgeFiscal!==canCreate||body.canPrintKitchen!==canCreate)
        throw fail('QR_BRIDGE_VERSION_UNSUPPORTED','Плагин должен подтвердить контракт версии 1 и допустимые функции',409);
      const allowed=canCreate?1:0;
      await env.DB.prepare(`INSERT INTO qr_pos_bridge_capabilities(
        restaurant_id,plugin_id,contract_version,can_create_order,can_ack_fiscal,can_print_kitchen,last_seen_at)
        VALUES(?1,?2,1,?3,?3,?3,?4)
        ON CONFLICT(restaurant_id,plugin_id) DO UPDATE SET
        contract_version=excluded.contract_version,
        can_create_order=excluded.can_create_order,
        can_ack_fiscal=excluded.can_ack_fiscal,
        can_print_kitchen=excluded.can_print_kitchen,
        last_seen_at=excluded.last_seen_at`)
        .bind(identity.departmentId,identity.pluginId,allowed,t).run();
      return response({success:true,contractVersion:1,accepted:true,orderingReady:canCreate});
    }
    if(action==='tablesSnapshot'){
      // Read-only POS catalog available even during the diagnostic hello mode:
      // uploading table names/IDs never authorizes a POS order or kitchen print.
      const list=body.tables;
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if(!Array.isArray(list)||list.length>400)
        throw fail('POS_TABLE_CATALOG_LIMIT','Снимок столов должен содержать не более 400 записей',400);
      const unique=new Set(),normalized=[];
      for(const item of list){
        const tableId=clean(item?.posTableId,90);
        const sectionId=clean(item?.sectionId,90);
        const name=clean(item?.name,70),section=clean(item?.sectionName,70);
        const number=Number(item?.number);
        if(!uuid.test(tableId)||!uuid.test(sectionId)||!name||!section||
          !Number.isInteger(number)||number<0||number>999999||
          typeof item?.isActive!=='boolean'||unique.has(tableId.toLowerCase()))
          throw fail('POS_TABLE_CATALOG_INVALID','Касса отправила некорректный список столов',400);
        unique.add(tableId.toLowerCase());
        normalized.push({posTableId:tableId,sectionId,name,sectionName:section,
          number,isActive:item.isActive});
      }
      await env.DB.prepare(`INSERT INTO qr_pos_table_snapshots
        (restaurant_id,plugin_id,table_count,tables_json,last_seen_at)
        VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(restaurant_id,plugin_id) DO UPDATE SET
        table_count=excluded.table_count,tables_json=excluded.tables_json,
        last_seen_at=excluded.last_seen_at`)
        .bind(identity.departmentId,identity.pluginId,normalized.length,
          JSON.stringify(normalized),t).run();
      return response({success:true,accepted:true,tableCount:normalized.length});
    }
    if(action==='pull'){
      // A diagnostic-only POS must not receive an order even if it sends pull.
      const caps=await env.DB.prepare(`SELECT can_create_order,can_ack_fiscal,can_print_kitchen,last_seen_at
        FROM qr_pos_bridge_capabilities WHERE restaurant_id=?1 AND plugin_id=?2 LIMIT 1`)
        .bind(identity.departmentId,identity.pluginId).first();
      const seen=Date.parse(caps?.last_seen_at||'');
      if(!caps||Number(caps.can_create_order)!==1||
          Number(caps.can_ack_fiscal)!==1||Number(caps.can_print_kitchen)!==1||
          !Number.isFinite(seen)||seen>Date.now()||Date.now()-seen>=5*60000)
        throw fail('QR_POS_NOT_READY','Касса работает в режиме диагностики или не подтверждала готовность',409);
      const nextLease=new Date(Date.now()+90000).toISOString();
      // Atomic leasing: two tills cannot both claim the same order.
      // pluginId is pinned to the currently configured plugin AND to the order when set.
      const item=await env.DB.prepare(`UPDATE qr_guest_orders
        SET state='LEASED',lease_until=?1,updated_at=?2,pos_plugin_id=?4
        WHERE id=(
          SELECT o.id FROM qr_guest_orders o JOIN qr_order_settings s ON s.menu_id=o.menu_id
          WHERE o.restaurant_id=?3 AND o.payment_state='UNPAID'
            AND o.payment_method='PAY_AT_POS'
            AND s.pos_plugin_id=?4
            AND (o.pos_plugin_id='' OR o.pos_plugin_id=?4)
            AND (o.state='AWAITING_POS' OR (o.state='LEASED' AND o.lease_until<?2))
          ORDER BY o.created_at ASC LIMIT 1
        )
        AND (state='AWAITING_POS' OR (state='LEASED' AND lease_until<?2))
        RETURNING *`).bind(nextLease,t,identity.departmentId,identity.pluginId).first();
      if(!item)return response({success:true,job:null});
      await env.DB.prepare(`INSERT INTO qr_order_events(id,order_id,owner_id,event_type,actor,details_json,created_at)
        VALUES(?1,?2,?3,'POS_LEASED','PLUGIN',?4,?5)`)
        .bind(crypto.randomUUID(),item.id,item.owner_id,JSON.stringify({pluginId:identity.pluginId}),t).run();
      return response({success:true,job:{
        externalOrderId:item.id,
        mode:item.service_mode,tableLabel:item.table_label,posTableId:item.pos_table_id,
        items:JSON.parse(item.items_json),
        totalMinor:item.total_minor,currency:item.currency,
        guestNote:item.guest_note,
        paymentMethod:'PAY_AT_POS',
        onlinePaid:false,rrn:null,
        leaseUntil:nextLease
      },notice:'Создайте заказ идемпотентно по externalOrderId; не проводите внешнюю онлайн-оплату.'});
    }
    if(action==='ackCreated'){
      const id=clean(body.externalOrderId,100),
        posId=clean(body.posOrderId,128),posNumber=clean(body.posOrderNumber,64);
      if(!id||!posId)throw fail('POS_ACK_REQUIRED','Не указан ID QR-заказа или кассового заказа',400);
      const order=await env.DB.prepare(`SELECT * FROM qr_guest_orders WHERE id=?1 AND restaurant_id=?2
        AND pos_plugin_id=?3 LIMIT 1`)
        .bind(id,identity.departmentId,identity.pluginId).first();
      if(!order)throw fail('QR_JOB_NOT_FOUND','Заказ не принадлежит данной кассе',404);
      if(order.state==='POS_OPEN'&&order.pos_order_id===posId)return response({success:true,duplicate:true});
      if(order.state!=='LEASED')throw fail('QR_JOB_STATE_CONFLICT','Заказ не находится в обработке POS',409);
      const result=await env.DB.prepare(`UPDATE qr_guest_orders SET state='POS_OPEN',
        pos_order_id=?1,pos_order_number=?2,pos_plugin_id=?3,lease_until='',last_error='',updated_at=?4
        WHERE id=?5 AND restaurant_id=?6 AND state='LEASED'
        RETURNING id`).bind(posId,posNumber,identity.pluginId,t,id,identity.departmentId).first();
      if(!result)throw fail('QR_JOB_RACE','Состояние заказа изменилось',409);
      await env.DB.prepare(`INSERT INTO qr_order_events(id,order_id,owner_id,event_type,actor,details_json,created_at)
        VALUES(?1,?2,?3,'POS_CREATED','PLUGIN',?4,?5)`)
        .bind(crypto.randomUUID(),id,order.owner_id,JSON.stringify({posOrderId:posId,posOrderNumber:posNumber}),t).run();
      return response({success:true,orderState:'POS_OPEN'});
    }
    if(action==='ackFailed'){
      const id=clean(body.externalOrderId,100),reason=clean(body.errorCode,90);
      if(!id||!reason)throw fail('POS_ERROR_REQUIRED','Укажите QR ID и код ошибки',400);
      const record=await env.DB.prepare(`UPDATE qr_guest_orders SET state='POS_FAILED',
        last_error=?1,lease_until='',updated_at=?2
        WHERE id=?3 AND restaurant_id=?4 AND state='LEASED'
        AND pos_plugin_id=?5 RETURNING id`)
        .bind(reason,t,id,identity.departmentId,identity.pluginId).first();
      if(!record)throw fail('POS_JOB_STATE','Заказ не может быть помечен ошибочным',409);
      const owner=await env.DB.prepare(`SELECT owner_id FROM qr_guest_orders WHERE id=?1`).bind(id).first();
      if(owner)await env.DB.prepare(`INSERT INTO qr_order_events
        (id,order_id,owner_id,event_type,actor,details_json,created_at)
        VALUES(?1,?2,?3,'POS_FAILED','PLUGIN',?4,?5)`)
        .bind(crypto.randomUUID(),id,owner.owner_id,JSON.stringify({errorCode:reason}),t).run();
      return response({success:true,orderState:'POS_FAILED'});
    }
    if(action==='ackKitchen'){
      const id=clean(body.externalOrderId,100),posId=clean(body.posOrderId,128);
      const status=clean(body.kitchenStatus,32);
      if(!id||!posId||!['PRINTED','CHECK_REQUIRED'].includes(status))
        throw fail('KITCHEN_ACK_REQUIRED','Укажите ID заказа на кассе и статус кухонной отправки',400);
      const prev=await env.DB.prepare(`SELECT id,owner_id,state,pos_order_id,kitchen_status
        FROM qr_guest_orders WHERE id=?1 AND restaurant_id=?2 AND pos_plugin_id=?3 LIMIT 1`)
        .bind(id,identity.departmentId,identity.pluginId).first();
      if(!prev||prev.pos_order_id!==posId)
        throw fail('KITCHEN_ORDER_MISMATCH','Чужой заказ или неверный ID кассы',403);
      if(!['POS_OPEN','CLOSED'].includes(prev.state))
        throw fail('KITCHEN_POS_NOT_CREATED','Сначала подтвердите создание заказа на кассе',409);
      if(prev.kitchen_status===status)return response({success:true,duplicate:true,kitchenStatus:status});
      if(prev.kitchen_status!=='NOT_SENT')
        throw fail('KITCHEN_STATUS_CONFLICT','Предыдущий результат кухонной печати требует ручной сверки',409);
      const saved=await env.DB.prepare(`UPDATE qr_guest_orders
        SET kitchen_status=?1,kitchen_updated_at=?2,updated_at=?2
        WHERE id=?3 AND restaurant_id=?4 AND pos_plugin_id=?5
          AND pos_order_id=?6 AND kitchen_status='NOT_SENT'
        RETURNING id`).bind(status,t,id,identity.departmentId,identity.pluginId,posId).first();
      if(!saved)throw fail('KITCHEN_ACK_RACE','Состояние кухонной печати уже изменено',409);
      await env.DB.prepare(`INSERT INTO qr_order_events
        (id,order_id,owner_id,event_type,actor,details_json,created_at)
        VALUES(?1,?2,?3,'KITCHEN_STATUS','PLUGIN',?4,?5)`)
        .bind(crypto.randomUUID(),id,prev.owner_id,JSON.stringify({kitchenStatus:status}),t).run();
      return response({success:true,kitchenStatus:status});
    }
    if(action==='ackFiscalized'){
      const id=clean(body.externalOrderId,100),
        posId=clean(body.posOrderId,128),receipt=clean(body.receiptNumber,100),
        fiscalReference=clean(body.fiscalReference,150),paymentKind=clean(body.paymentKind,25);
      const rrn=clean(body.rrn,40);
      if(!id||!posId||!receipt||!fiscalReference||!['POS_CASH','POS_CARD'].includes(paymentKind))
        throw fail('FISCAL_PROOF_REQUIRED','Необходимо подтверждение реального закрытия кассой и фискальный реквизит',400);
      if(rrn&&!/^[A-Za-z0-9-]{6,40}$/.test(rrn))throw fail('RRN_INVALID','Некорректный RRN',400);
      const prev=await env.DB.prepare(`SELECT state,pos_order_id,owner_id,payment_method FROM qr_guest_orders
        WHERE id=?1 AND restaurant_id=?2 AND pos_plugin_id=?3`)
        .bind(id,identity.departmentId,identity.pluginId).first();
      if(!prev)throw fail('POS_ORDER_SCOPE','Заказ не принадлежит кассе',404);
      if(prev.state==='CLOSED'&&prev.pos_order_id===posId)return response({success:true,duplicate:true});
      if(prev.state!=='POS_OPEN'||prev.pos_order_id!==posId||prev.payment_method!=='PAY_AT_POS')
        throw fail('POS_CLOSE_STATE','Заказ не был предварительно подтверждён на кассе',409);
      const result=await env.DB.prepare(`UPDATE qr_guest_orders SET state='CLOSED',
        payment_state='PAID_AT_POS',pos_receipt_number=?1,fiscal_reference=?2,rrn=?3,updated_at=?4
        WHERE id=?5 AND restaurant_id=?6 AND state='POS_OPEN' AND pos_order_id=?7
        RETURNING id`).bind(receipt,fiscalReference,rrn,t,id,identity.departmentId,posId).first();
      if(!result)throw fail('POS_CLOSE_RACE','Кассовый заказ уже изменён',409);
      await env.DB.prepare(`INSERT INTO qr_order_events(id,order_id,owner_id,event_type,actor,details_json,created_at)
        VALUES(?1,?2,?3,'FISCAL_CLOSED','PLUGIN',?4,?5)`)
        .bind(crypto.randomUUID(),id,prev.owner_id,
          JSON.stringify({receiptNumber:receipt,fiscalReference,paymentKind,rrn:rrn||null}),t).run();
      return response({success:true,orderState:'CLOSED'});
    }
    throw fail('UNKNOWN_POS_ACTION','Неизвестная операция POS Bridge',400);
  }catch(e){return error(e)}
}
