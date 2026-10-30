import {ensureOrders,adminContext,settings,token,response,bad,fail,clean,eventStmt} from './_lib/orders.js';
import {registeredPosRegisters} from './_lib/pos-registers.js';
import {requireTableSyncScope,isSharedD1Test} from './_lib/table-sync-policy.js';
const error=e=>bad(e.status||500,e.code||'QR_ADMIN_ERROR',e.status?e.message:'Не удалось обработать запрос');
export async function onRequestOptions(){return new Response(null,{status:204,headers:{Allow:'GET,POST,OPTIONS'}})}
export async function onRequestGet({request,env}){
  try{
    await ensureOrders(env.DB);
    const ctx=await adminContext(request,env);
    const [cfg,tables,orders]=await Promise.all([
      settings(env.DB,ctx.menu.id),
      env.DB.prepare(`SELECT id,table_label,table_key,pos_table_id,section_name,active FROM qr_order_tables
        WHERE menu_id=?1 ORDER BY table_label COLLATE NOCASE LIMIT 250`).bind(ctx.menu.id).all(),
      env.DB.prepare(`SELECT id,service_mode,table_label,state,payment_state,items_json,total_minor,
        currency,created_at,updated_at,pos_order_number,pos_receipt_number,last_error,guest_note,kitchen_status
        FROM qr_guest_orders WHERE owner_id=?1 AND restaurant_id=?2
        ORDER BY created_at DESC LIMIT 100`).bind(ctx.ownerId,ctx.restaurantId).all()
    ]);
    if(cfg&&(cfg.owner_id!==ctx.ownerId||cfg.restaurant_id!==ctx.restaurantId))
      throw fail('CROSS_WORKSPACE_FORBIDDEN','QR Menu принадлежит другому рабочему пространству',403);
    const posStatus=cfg?.pos_plugin_id
      ?await env.DB.prepare(`SELECT last_seen_at,can_create_order,can_ack_fiscal,can_print_kitchen
        FROM qr_pos_bridge_capabilities
        WHERE restaurant_id=?1 AND plugin_id=?2 AND contract_version=1 LIMIT 1`)
        .bind(ctx.restaurantId,cfg.pos_plugin_id).first()
      :null;
    const lastSeen=Date.parse(posStatus?.last_seen_at||'');
    const bridgeConnected=Boolean(posStatus&&Number.isFinite(lastSeen)&&
      lastSeen<=Date.now()&&Date.now()-lastSeen<5*60*1000);
    const bridgeReady=bridgeConnected&&Number(posStatus.can_create_order)===1&&
      Number(posStatus.can_ack_fiscal)===1&&Number(posStatus.can_print_kitchen)===1;
    const snapshot=cfg?.pos_plugin_id
      ?await env.DB.prepare(`SELECT table_count,tables_json,last_seen_at
        FROM qr_pos_table_snapshots WHERE restaurant_id=?1 AND plugin_id=?2 LIMIT 1`)
        .bind(ctx.restaurantId,cfg.pos_plugin_id).first()
      :null;
    const snapshotTime=Date.parse(snapshot?.last_seen_at||'');
    const catalogFresh=Boolean(snapshot&&Number.isFinite(snapshotTime)&&
      snapshotTime<=Date.now()&&Date.now()-snapshotTime<15*60*1000);
    let tableSyncAllowed=false;
    if(cfg?.pos_plugin_id){
      try{
        requireTableSyncScope(request,env,{
          departmentId:ctx.restaurantId,pluginId:cfg.pos_plugin_id
        });
        tableSyncAllowed=true;
      }catch(_ignored){/* Read-only status reports scope unavailable. */}
    }
    const catalogTables=catalogFresh&&tableSyncAllowed?JSON.parse(snapshot.tables_json||'[]'):[];
    const origin=new URL(request.url).origin;
    const url=origin+'/menu.html?id='+encodeURIComponent(ctx.menu.public_slug);
    return response({success:true,restaurantId:ctx.restaurantId,menuName:ctx.menu.restaurant_name,
      menuUrl:url,
      settings:{serviceMode:cfg?.service_mode||'TABLE',
        orderingEnabled:Boolean(cfg?.ordering_enabled),posPluginId:cfg?.pos_plugin_id||'',
        posBridgeConnected:bridgeConnected,posBridgeReady:bridgeReady,
        posBridgeLastSeen:bridgeConnected?posStatus.last_seen_at:null,
        backendSetup:{
          // An explicit infrastructure confirmation; never a claim that the
          // binding was independently verified by the browser.
          tableSyncMode:clean(env.QR_TABLE_SYNC_MODE,24),
          tableSyncAllowed,
          bridgeTokenConfigured:Boolean(clean(env.QR_POS_BRIDGE_TOKEN)),
          ingressTokenConfigured:Boolean(clean(env.PLUGIN_INGEST_TOKEN)),
          rateSecretConfigured:Boolean(clean(env.QR_ORDER_RATE_SECRET))
        },
        onlinePaymentEnabled:false},
      posTableCatalog:{
        available:catalogFresh&&tableSyncAllowed,
        lastSeenAt:tableSyncAllowed?snapshot?.last_seen_at||null:null,
        count:catalogTables.length,
        tables:catalogTables
      },
      tables:(tables.results||[]).map(t=>({...t,active:Boolean(t.active),
        url:url+'&table='+encodeURIComponent(t.table_key)})),
      orders:(orders.results||[]).map(o=>({...o,items:JSON.parse(o.items_json||'[]'),items_json:undefined,
        totalAZN:(Number(o.total_minor)/100).toFixed(2)}))});
  }catch(e){return error(e)}
}
export async function onRequestPost({request,env}){
  try{
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=='object'||Array.isArray(body))throw fail('BAD_REQUEST','Некорректный запрос');
    const action=clean(body.action,40);
    // Never allow order activation in the shared-D1 table-test mode.
    if(isSharedD1Test(env)&&action==='saveSettings'&&body.orderingEnabled===true)
      throw fail('QR_SHARED_D1_ORDERS_DISABLED',
        'На общей D1 сейчас разрешена синхронизация столов, но не QR-заказы',409);
    await ensureOrders(env.DB);
    const ctx=await adminContext(request,env);
    const existing=await settings(env.DB,ctx.menu.id);
    if(existing&&(existing.owner_id!==ctx.ownerId||existing.restaurant_id!==ctx.restaurantId))
      throw fail('CROSS_WORKSPACE_FORBIDDEN','QR Menu принадлежит другому рабочему пространству',403);
    const now=new Date().toISOString();
    if(action==='saveSettings'){
      const mode=clean(body.serviceMode,30),pluginId=clean(body.posPluginId,100);
      if(!['TABLE','FAST_FOOD'].includes(mode))throw fail('BAD_MODE','Выберите режим столов или фастфуд');
      if(pluginId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pluginId))
        throw fail('BAD_PLUGIN_ID','Выберите зарегистрированную кассу из списка');
      // An arbitrary plugin ID in a browser request must never route
      // orders to another restaurant, even if the UI list was modified.
      if(pluginId && pluginId.toLowerCase()!==clean(existing?.pos_plugin_id,100).toLowerCase()){
        const devices=await registeredPosRegisters(env,ctx.restaurantId);
        if(!devices.some(x=>x.pluginId.toLowerCase()===pluginId.toLowerCase()))
          throw fail('QR_POS_NOT_IN_RESTAURANT','Выбранная касса не зарегистрирована в этом ресторане',403);
      }
      if(existing?.pos_plugin_id&&existing.pos_plugin_id!==pluginId){
        const outstanding=await env.DB.prepare(`SELECT id FROM qr_guest_orders
          WHERE menu_id=?1 AND state IN ('AWAITING_POS','LEASED','POS_OPEN','POS_FAILED') LIMIT 1`)
          .bind(ctx.menu.id).first();
        if(outstanding)throw fail('PLUGIN_CHANGE_LOCKED','Нельзя менять кассовый плагин при незавершённых заказах',409);
      }
      const enabled=body.orderingEnabled===true?1:0;
      if(enabled&&!clean(env.QR_ORDER_RATE_SECRET))
        throw fail('QR_RATE_NOT_CONFIGURED','Перед включением заказов настройте QR_ORDER_RATE_SECRET в Cloudflare Pages',409);
      if(enabled){
        if(!clean(env.QR_POS_BRIDGE_TOKEN)||!clean(env.PLUGIN_INGEST_TOKEN)||!pluginId)
          throw fail('POS_BRIDGE_NOT_CONFIGURED','Не настроены POS Bridge и ID кассового плагина',409);
        const ready=await env.DB.prepare(`SELECT last_seen_at FROM qr_pos_bridge_capabilities
          WHERE restaurant_id=?1 AND plugin_id=?2 AND contract_version=1
            AND can_create_order=1 AND can_ack_fiscal=1 AND can_print_kitchen=1 LIMIT 1`)
          .bind(ctx.restaurantId,pluginId).first();
        const recent=Date.parse(ready?.last_seen_at||'');
        if(!Number.isFinite(recent)||recent>Date.now()||Date.now()-recent>=5*60000)
          throw fail('POS_BRIDGE_NOT_READY','Кассовый плагин не подтвердил поддержку QR-заказов за последние 5 минут',409);
      }
      await env.DB.prepare(`INSERT INTO qr_order_settings
        (owner_id,menu_id,restaurant_id,service_mode,ordering_enabled,pos_plugin_id,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?7)
        ON CONFLICT(menu_id) DO UPDATE SET service_mode=excluded.service_mode,
          ordering_enabled=excluded.ordering_enabled,pos_plugin_id=excluded.pos_plugin_id,
          updated_at=excluded.updated_at`)
        .bind(ctx.ownerId,ctx.menu.id,ctx.restaurantId,mode,enabled,pluginId,now).run();
      return response({success:true,notice:enabled?'Приём тестовых QR-заказов включён: POS-мост подтвердил полную готовность.':'Приём заказов выключен.'});
    }
    if(action==='syncPosTables'){
      requireTableSyncScope(request,env,{
        departmentId:ctx.restaurantId,pluginId:clean(existing?.pos_plugin_id,100)
      });
      // Only data previously signed by a registered plugin belonging to this
      // restaurant may be imported. Browser cannot choose a different plugin.
      const pluginId=clean(existing?.pos_plugin_id,100);
      if(!pluginId)throw fail('QR_POS_SELECT_REQUIRED','Сначала выберите и сохраните кассу',409);
      if(existing?.service_mode!=='TABLE')
        throw fail('QR_TABLE_MODE_REQUIRED','Переключите QR-заказы в режим ресторана',409);
      const snap=await env.DB.prepare(`SELECT tables_json,last_seen_at FROM qr_pos_table_snapshots
        WHERE restaurant_id=?1 AND plugin_id=?2 LIMIT 1`)
        .bind(ctx.restaurantId,pluginId).first();
      const stamped=Date.parse(snap?.last_seen_at||'');
      if(!snap||!Number.isFinite(stamped)||stamped>Date.now()||
          Date.now()-stamped>=15*60000)
        throw fail('QR_POS_TABLES_UNAVAILABLE','Нет свежего списка столов с выбранной кассы. Проверьте QR Bridge.',409);
      const catalog=JSON.parse(snap.tables_json||'[]');
      const requested=body.posTableIds;
      if(!Array.isArray(requested)||requested.length<1||requested.length>250)
        throw fail('QR_TABLE_SELECTION_INVALID','Выберите от 1 до 250 столов',400);
      const want=new Set(requested.map(x=>clean(x,100).toLowerCase()));
      if(want.size!==requested.length)
        throw fail('QR_TABLE_SELECTION_INVALID','В списке есть повторяющиеся столы',400);
      const selected=catalog.filter(x=>want.has(clean(x.posTableId,100).toLowerCase())&&x.isActive===true);
      if(selected.length!==want.size)
        throw fail('QR_TABLE_SELECTION_INVALID','Некоторые столы неактивны или отсутствуют на выбранной кассе',409);
      const rows=(await env.DB.prepare(`SELECT id,table_label,pos_table_id FROM qr_order_tables
        WHERE menu_id=?1 AND owner_id=?2 LIMIT 260`).bind(ctx.menu.id,ctx.ownerId).all()).results||[];
      if(rows.length>250||rows.length+selected.filter(x=>
        !rows.some(y=>clean(y.pos_table_id,100).toLowerCase()===x.posTableId.toLowerCase())).length>250)
        throw fail('QR_TABLE_COUNT_LIMIT','Превышен лимит 250 QR-столов в одном меню',409);
      const idToRow=new Map();
      const labels=new Set();
      for(const row of rows){
        const key=clean(row.pos_table_id,100).toLowerCase();
        if(key){
          if(idToRow.has(key))
            throw fail('QR_POS_TABLE_DUPLICATE','В QR Menu уже есть дублирующиеся привязки POS-стола',409);
          idToRow.set(key,row);
        }
        labels.add(String(row.table_label).toLowerCase());
      }
      const sanitize=value=>clean(value,70).replace(/[^\p{L}\p{N} ._\-№]/gu,' ')
        .replace(/\s+/g,' ').trim();
      const changes=[];
      let created=0,linked=0;
      for(const table of selected){
        const id=table.posTableId.toLowerCase();
        const current=idToRow.get(id);
        const section=sanitize(table.sectionName).slice(0,70)||'Зал';
        const name=sanitize(table.name).slice(0,70)||('Стол '+table.number);
        let label=(section+' - '+name).slice(0,48).trim();
        if(!/^[\p{L}\p{N} ._\-№]{1,48}$/u.test(label))
          throw fail('QR_TABLE_LABEL_INVALID','На кассе некорректное название стола',409);
        if(current){
          linked++;
          // Keep its human-readable label and, crucially, its permanent QR
          // token. Section may be updated without affecting printed QR codes.
          changes.push(env.DB.prepare(`UPDATE qr_order_tables
            SET section_name=?1,updated_at=?2
            WHERE menu_id=?3 AND owner_id=?4 AND id=?5`)
            .bind(section,now,ctx.menu.id,ctx.ownerId,current.id));
        }else{
          if(labels.has(label.toLowerCase())){
            label=(label.slice(0,37).trim()+'-'+id.slice(0,8)).slice(0,48);
          }
          if(labels.has(label.toLowerCase()))
            throw fail('QR_TABLE_LABEL_CONFLICT','Обнаружены одинаковые названия POS-столов',409);
          labels.add(label.toLowerCase());
          created++;
          changes.push(env.DB.prepare(`INSERT INTO qr_order_tables
            (owner_id,menu_id,id,table_label,table_key,pos_table_id,
             active,created_at,updated_at,section_name)
            VALUES(?1,?2,?3,?4,?5,?6,1,?7,?7,?8)`)
            .bind(ctx.ownerId,ctx.menu.id,crypto.randomUUID(),label,token(),table.posTableId,now,section));
        }
      }
      // D1 batch is transactional. A conflict must never leave a half-import.
      if(changes.length)await env.DB.batch(changes);
      return response({success:true,created,linked,total:selected.length,
        notice:'Синхронизировано столов: '+selected.length+'. Новых: '+created+
          '. Существующие QR-коды сохранены.'});
    }
    if(action==='addTable'){
      const name=clean(body.label,48),posId=clean(body.posTableId,120);
      if(!/^[\p{L}\p{N} ._\-№]{1,48}$/u.test(name))throw fail('INVALID_TABLE_LABEL','Некорректное название стола');
      if(posId&&!/^[A-Za-z0-9_.:-]{1,120}$/.test(posId))throw fail('INVALID_POS_TABLE','Некорректный ID стола на кассе');
      const id=crypto.randomUUID();
      try{
        await env.DB.prepare(`INSERT INTO qr_order_tables
          (owner_id,menu_id,id,table_label,table_key,pos_table_id,created_at,updated_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?7)`)
          .bind(ctx.ownerId,ctx.menu.id,id,name,token(),posId,now).run();
      }catch(e){if(/UNIQUE|constraint/i.test(e.message))throw fail('TABLE_DUPLICATE','Стол с таким названием уже существует',409);throw e}
      return response({success:true,id,notice:'QR-код создан для стола '+name});
    }
    if(['rotateTable','setTableActive','setPosTable'].includes(action)){
      const id=clean(body.tableId,100);
      const table=await env.DB.prepare(`SELECT id,table_label FROM qr_order_tables
        WHERE id=?1 AND menu_id=?2 AND owner_id=?3`).bind(id,ctx.menu.id,ctx.ownerId).first();
      if(!table)throw fail('TABLE_NOT_FOUND','Стол не найден',404);
      let query,bindings;
      if(action==='rotateTable'){
        query=`UPDATE qr_order_tables SET table_key=?1,updated_at=?2 WHERE id=?3 AND menu_id=?4`;
        bindings=[token(),now,id,ctx.menu.id];
      }else if(action==='setTableActive'){
        query=`UPDATE qr_order_tables SET active=?1,updated_at=?2 WHERE id=?3 AND menu_id=?4`;
        bindings=[body.active===true?1:0,now,id,ctx.menu.id];
      }else{
        const posId=clean(body.posTableId,120);
        if(posId&&!/^[A-Za-z0-9_.:-]{1,120}$/.test(posId))throw fail('INVALID_POS_TABLE','Некорректный ID стола');
        query=`UPDATE qr_order_tables SET pos_table_id=?1,updated_at=?2 WHERE id=?3 AND menu_id=?4`;
        bindings=[posId,now,id,ctx.menu.id];
      }
      await env.DB.prepare(query).bind(...bindings).run();
      return response({success:true,notice:'Стол обновлён'});
    }
    if(action==='retryValidationFailure'){
      const id=clean(body.orderId,100);
      // Only a strictly pre-SubmitChanges validation error is safely retryable.
      // POS_RESULT_UNKNOWN means a real iikoFront order may already exist.
      const changed=await env.DB.prepare(`UPDATE qr_guest_orders
        SET state='AWAITING_POS',last_error='',lease_until='',updated_at=?1
        WHERE id=?2 AND owner_id=?3 AND restaurant_id=?4
          AND state='POS_FAILED' AND last_error='POS_VALIDATION_FAILED'
          AND pos_order_id='' AND payment_state='UNPAID'
        RETURNING id`)
        .bind(now,id,ctx.ownerId,ctx.restaurantId).first();
      if(!changed)
        throw fail('QR_RETRY_UNSAFE','Повтор запрещён: заказ мог быть создан на кассе. Проверьте его вручную.',409);
      await env.DB.prepare(`INSERT INTO qr_order_events
        (id,order_id,owner_id,event_type,actor,details_json,created_at)
        VALUES(?1,?2,?3,'SAFE_RETRY_REQUESTED','STAFF','{}',?4)`)
        .bind(crypto.randomUUID(),id,ctx.ownerId,now).run();
      return response({success:true,notice:'Заказ возвращён в очередь после исправления причины отказа.'});
    }
    if(action==='cancelPending'){
      const id=clean(body.orderId,100);
      const result=await env.DB.prepare(`UPDATE qr_guest_orders
        SET state='CANCELLED',updated_at=?1
        WHERE id=?2 AND owner_id=?3 AND restaurant_id=?4 AND state='AWAITING_POS'
        RETURNING id`).bind(now,id,ctx.ownerId,ctx.restaurantId).first();
      if(!result)throw fail('CANNOT_CANCEL','Заказ уже затронут кассовым обменом или не найден. Требуется проверка на кассе.',409);
      await env.DB.prepare(`INSERT INTO qr_order_events(id,order_id,owner_id,event_type,actor,created_at)
        VALUES(?1,?2,?3,'CANCELLED_BY_ADMIN','STAFF',?4)`)
        .bind(crypto.randomUUID(),id,ctx.ownerId,now).run();
      return response({success:true,notice:'Ожидающий заказ отменён'});
    }
    throw fail('UNKNOWN_ACTION','Неизвестное действие',400);
  }catch(e){return error(e)}
}
