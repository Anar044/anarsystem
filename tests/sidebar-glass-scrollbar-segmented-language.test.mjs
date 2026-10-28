import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('persistent-workspace.html');
const i18n=read('sh-i18n.js');

test('only the persistent sidebar gets premium B glass scrollbars',()=>{
  assert.match(html,/body\.sh-workspace-page \.app-shell>\.sidebar::-webkit-scrollbar\{/);
  assert.match(html,/body\.sh-workspace-page \.app-shell>\.sidebar::-webkit-scrollbar-track\{/);
  assert.match(html,/body\.sh-workspace-page \.app-shell>\.sidebar::-webkit-scrollbar-thumb\{/);
  assert.match(html,/background:linear-gradient\(180deg,#16d0ed,#24d3a4 55%,#0e9f93\)/);
  assert.match(html,/body\.sh-workspace-page \.app-shell>\.sidebar::-webkit-scrollbar-button\{/);
  assert.match(html,/scrollbar-color:#149f8c #0b1925/);
  assert.match(html,/sh-sidebar-collapsed \.app-shell>\.sidebar::-webkit-scrollbar\{/);
  assert.doesNotMatch(html,/\.sh-workspace-frame::-webkit-scrollbar/);
});
test('premium C language selector is compact and accessible',()=>{
  assert.match(html,/\.sh-language-segments\{/);
  assert.match(html,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(html,/\.sh-language-segment\.is-active\{/);
  assert.match(html,/\.sh-language-segment:focus-visible\{/);
  assert.match(html,/sh-sidebar-collapsed \.sidebar \.sh-language-segments\{/);
  assert.match(html,/sh-sidebar-collapsed \.sidebar \.sh-language-select\{/);
  assert.match(html,/sh-i18n\.js\?v=20261028-segmented-c1/);
  assert.doesNotMatch(i18n,/localStorage\.clear\(/);
  assert.doesNotMatch(i18n,/window\.location\s*=/);
});
test('segmented RU/AZ/EN buttons update shared language state and compact select',()=>{
  const begin=i18n.indexOf('  function update(next,{save=true}={})');
  const end=i18n.indexOf('  let observer=null;',begin);
  assert.ok(begin>0&&end>begin,'select and change functions exist');
  const listeners=new Map();
  const makeElement=(tag)=>({
    tag,children:[],dataset:{},attrs:{},className:'',textContent:'',
    value:'',title:'',
    setAttribute(k,v){this.attrs[k]=v},
    appendChild(child){this.children.push(child)},
    append(...children){this.children.push(...children)},
    addEventListener(evt,fn){this.events??={};this.events[evt]=fn},
    classList:{
      toggle(name,on){this.states??={};this.states[name]=on}
    }
  });
  // Attach class state to each button (classList owns the mock element).
  function elem(tag){
    const node=makeElement(tag);
    node.classList={toggle(name,on){node.states??={};node.states[name]=on}};
    return node;
  }
  const sidebar=elem('aside');
  const document={
    body:{classList:{contains:k=>k==='sh-workspace-page'}},
    documentElement:{lang:'ru'},
    createElement:elem,
    querySelector(query){
      if(query==='.sidebar')return sidebar;
      if(query==='#sh-language-select')return sidebar.children.flatMap(w=>w.children)
          .find(n=>n.id==='sh-language-select')||null;
      return null;
    },
    querySelectorAll(query){
      if(query==='.sh-language-segment')return sidebar.children.flatMap(w=>w.children)
        .flatMap(n=>n.children).filter(n=>n.className.startsWith('sh-language-segment'));
      return [];
    }
  };
  sidebar.querySelector=query=>document.querySelector(query);
  const stored=new Map();
  const localStorage={setItem(k,v){stored.set(k,v)}};
  const events=[];
  const window={dispatchEvent(e){events.push(e.detail.language)}};
  const CustomEvent=class {constructor(name,options){this.name=name;this.detail=options.detail}};
  const create=new Function('document','window','localStorage','CustomEvent','location','schedule',
    "let language='ru';const LANGUAGES=['az','ru','en'];const STORAGE_KEY='shUiLanguage';\n"+
    i18n.slice(begin,end)+"\nreturn {createSwitcher,update,getLanguage:()=>language};");
  const api=create(document,window,localStorage,CustomEvent,{origin:'https://smarthoreca.pages.dev'},()=>{});
  api.createSwitcher();
  const wrap=sidebar.children[0],segments=wrap.children[1],select=wrap.children[2];
  assert.deepEqual(segments.children.map(n=>n.textContent),['RU','AZ','EN']);
  assert.equal(segments.attrs.role,'group');
  assert.equal(select.value,'ru');
  assert.equal(segments.children[0].attrs['aria-pressed'],'true');
  segments.children[1].events.click();
  assert.equal(api.getLanguage(),'az');
  assert.equal(select.value,'az');
  assert.equal(stored.get('shUiLanguage'),'az');
  assert.deepEqual(segments.children.map(n=>n.attrs['aria-pressed']),['false','true','false']);
  assert.deepEqual(events,['az']);
  select.value='en';
  select.events.change();
  assert.equal(api.getLanguage(),'en');
  assert.deepEqual(segments.children.map(n=>n.attrs['aria-pressed']),['false','false','true']);
  assert.equal(stored.get('shUiLanguage'),'en');
  api.createSwitcher();
  assert.equal(sidebar.children.length,1,'switcher must not duplicate on re-render');
});
