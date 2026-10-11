import { activeTab, ensureRuntime, probeRuntime, request } from './client';
import { BLACKOUT_COLORS, DEFAULT_APPEARANCE, validateAppearance, type BlackoutAppearance, type BlackoutColor, type BlackoutStyle } from '../../engine/appearance';
import { DEFAULT_PATTERN_CATEGORIES, PATTERN_PREFERENCES_KEY, PREFERENCES_KEY, validatePatternCategories, validatePopupPreferences, type PatternCategories, type PopupMode, type PopupPreferences, type ThemePreference } from '../../shared/settings';
import type { RequestMap, RequestType, Response, RuntimeSnapshot } from '../../shared/protocol';

const APPEARANCE_KEY = 'blackoutAppearance';
const COLOR_NAMES: Record<BlackoutColor,string> = {'#242321':'Ink black','#f7f4ec':'Warm white','#a65d51':'Muted terracotta','#a8977c':'Warm taupe','#65786c':'Muted sage'};
const element=<T extends HTMLElement>(id:string):T=>{const node=document.getElementById(id);if(!node)throw new Error(`Missing #${id}`);return node as T};
const setRole=(button:HTMLButtonElement,role:'primary'|'secondary'|'link')=>{button.classList.toggle('btn',role!=='link');button.classList.toggle('block',role!=='link');button.classList.toggle('link',role==='link');button.classList.toggle('primary',role==='primary');button.classList.toggle('secondary',role==='secondary')};
const setStatus=(message:string,error=false)=>{const node=element('status');node.textContent=message;node.dataset.error=String(error)};

document.addEventListener('DOMContentLoaded',async()=>{
  const stored=await chrome.storage.local.get([PATTERN_PREFERENCES_KEY,PREFERENCES_KEY,APPEARANCE_KEY]);
  let preferences=validatePopupPreferences(stored[PREFERENCES_KEY]);
  let appearance=validateAppearance(stored[APPEARANCE_KEY])??{...DEFAULT_APPEARANCE};
  const categories=validatePatternCategories(stored[PATTERN_PREFERENCES_KEY]??DEFAULT_PATTERN_CATEGORIES);
  let current:RuntimeSnapshot|null=null;
  const manual=element<HTMLButtonElement>('manualActionBtn'),poetry=element<HTMLButtonElement>('poetryActionBtn');
  const scan=element<HTMLButtonElement>('scanPatternsBtn');
  const email=element<HTMLInputElement>('patternEmail'),url=element<HTMLInputElement>('patternUrl'),phone=element<HTMLInputElement>('patternPhone');
  email.checked=categories.email;url.checked=categories.url;phone.checked=categories.phone;

  const applyTheme=(theme:ThemePreference)=>{if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme};
  applyTheme(preferences.theme);
  document.querySelector<HTMLInputElement>(`input[name=theme][value=${preferences.theme}]`)!.checked=true;

  const savePreferences=async(patch:Partial<PopupPreferences>)=>{preferences={...preferences,...patch};applyTheme(preferences.theme);await chrome.storage.local.set({[PREFERENCES_KEY]:preferences})};
  const selectMode=(mode:PopupMode,focus=false)=>{
    preferences={...preferences,mode};
    for(const tab of document.querySelectorAll<HTMLButtonElement>('[role=tab]')){const selected=tab.dataset.mode===mode;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus()}
    for(const panel of document.querySelectorAll<HTMLElement>('[role=tabpanel]'))panel.hidden=panel.id!==`${mode==='pattern-mask'?'pattern':mode}Panel`;
    void chrome.storage.local.set({[PREFERENCES_KEY]:preferences});
  };
  selectMode(preferences.mode);

  function render(state:RuntimeSnapshot){
    current=state;const manualActive=state.editing.mode==='manual',poetryActive=state.editing.mode==='poetry';
    manual.textContent=manualActive?'Done':'Start selecting';manual.setAttribute('aria-pressed',String(manualActive));
    const drafting=state.poetry.keptCount>0||state.poetry.editing;
    poetry.textContent=poetryActive?'Done composing':drafting?'Continue composing':'Start composing';poetry.setAttribute('aria-pressed',String(poetryActive));setRole(poetry,drafting?'secondary':'primary');
    element('poetryDraftControls').hidden=!drafting;element('poetryStats').textContent=`${state.poetry.keptCount} kept · ${state.poetry.blockCount} ${state.poetry.blockCount===1?'block':'blocks'}`;
    element<HTMLButtonElement>('applyPoetryBtn').disabled=!state.poetry.canApply;element('clearPoetryBtn').hidden=state.poetry.keptCount===0;element('editPoetryBtn').hidden=!state.poetry.canEdit||drafting;element('cancelPoetryEditBtn').hidden=!state.poetry.editing;
    element<HTMLButtonElement>('undoBtn').disabled=!state.history.canUndo;element<HTMLButtonElement>('redoBtn').disabled=!state.history.canRedo;
    const scanned=state.pattern.status!=='idle';element('patternResults').hidden=!scanned;element('cancelPatternBtn').hidden=!scanned;scan.textContent=scanned?'Scan again':'Scan page';const applicable=state.pattern.total>0&&state.pattern.status==='scanned';setRole(scan,applicable?'link':'primary');element('patternLinks').prepend(scan);if(!applicable)element('patternPanel').insertBefore(scan,element('patternLinks'));element('patternCounts').textContent=state.pattern.total?`${state.pattern.counts.email} Email · ${state.pattern.counts.url} URL · ${state.pattern.counts.phone} Phone`:state.pattern.status==='invalid'?'Page changed. Scan again.':'No supported patterns found.';
    element<HTMLButtonElement>('applyPatternsBtn').hidden=state.pattern.total===0||state.pattern.status!=='scanned';
  }

  async function send<T extends RequestType>(type:T,payload:RequestMap[T]['payload']):Promise<Response<RequestMap[T]['data']>>{
    const tab=await activeTab();if(!tab.ok){setStatus(tab.error.message,true);return tab}const runtime=await ensureRuntime(tab.data);if(!runtime.ok){setStatus(runtime.error.message,true);return runtime}
    if(type!=='SET_APPEARANCE'&&JSON.stringify(runtime.data.state.appearance)!==JSON.stringify(appearance))await request(tab.data.id!,'SET_APPEARANCE',appearance);
    const result=await request(tab.data.id!,type,payload);if(!result.ok)setStatus(result.error.message,true);else{const data=result.data as Partial<RuntimeSnapshot>;if(data.history&&data.poetry&&data.pattern)render(data as RuntimeSnapshot);setStatus('')}return result;
  }

  const renderAppearance=()=>{
    for(const button of document.querySelectorAll<HTMLButtonElement>('.style-choice'))button.setAttribute('aria-checked',String(button.dataset.style===appearance.style));
    for(const button of document.querySelectorAll<HTMLButtonElement>('.swatch'))button.setAttribute('aria-checked',String(button.dataset.color===appearance.color));
    // ARIA radio pattern: only the checked option is a Tab stop.
    for(const button of document.querySelectorAll<HTMLButtonElement>('.style-choice,.swatch'))button.tabIndex=button.getAttribute('aria-checked')==='true'?0:-1;
  };
  // Arrow/Home/End move and select within a radiogroup, like native radio buttons.
  for(const group of document.querySelectorAll<HTMLElement>('.style-options,.colors'))group.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const options=[...group.querySelectorAll<HTMLButtonElement>('[role=radio]')],current=options.indexOf(event.target as HTMLButtonElement);if(current<0)return;
    event.preventDefault();const step=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
    const next=options[event.key==='Home'?0:event.key==='End'?options.length-1:(current+step+options.length)%options.length]!;next.focus();next.click();
  });
  for(const color of BLACKOUT_COLORS){const button=document.createElement('button');button.type='button';button.className='swatch';button.dataset.color=color;button.setAttribute('role','radio');button.setAttribute('aria-label',COLOR_NAMES[color]);button.style.setProperty('--swatch-color',color);element('colorChoices').append(button);button.addEventListener('click',()=>void changeAppearance({...appearance,color}))}
  async function changeAppearance(next:BlackoutAppearance){appearance=next;renderAppearance();await chrome.storage.local.set({[APPEARANCE_KEY]:appearance});if(current)await send('SET_APPEARANCE',appearance)}
  for(const button of document.querySelectorAll<HTMLButtonElement>('.style-choice'))button.addEventListener('click',()=>void changeAppearance({...appearance,style:button.dataset.style as BlackoutStyle}));renderAppearance();

  for(const tab of document.querySelectorAll<HTMLButtonElement>('[role=tab]')){tab.addEventListener('click',()=>selectMode(tab.dataset.mode as PopupMode));tab.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];let index=tabs.indexOf(tab);index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectMode(tabs[index]!.dataset.mode as PopupMode,true)})}

  // Focus moves into Settings on open and back to the trigger on close. Pointer-initiated moves (MouseEvent.detail>0)
  // keep focus semantics but skip the keyboard-style ring; keyboard-initiated moves keep it visible.
  const settings=element('settingsPanel'),settingsButton=element<HTMLButtonElement>('settingsBtn');
  const moveFocus=(target:HTMLElement,pointer:boolean)=>target.focus({focusVisible:!pointer} as FocusOptions);
  const closeSettings=(pointer=false)=>{settings.hidden=true;settingsButton.setAttribute('aria-expanded','false');moveFocus(settingsButton,pointer)};
  settingsButton.addEventListener('click',event=>{const open=settings.hidden;settings.hidden=!open;settingsButton.setAttribute('aria-expanded',String(open));if(open)moveFocus(element('closeSettingsBtn'),event.detail>0)});
  element('closeSettingsBtn').addEventListener('click',event=>closeSettings(event.detail>0));document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!settings.hidden){event.preventDefault();closeSettings()}});
  const autoMask=element<HTMLInputElement>('autoMask');autoMask.checked=preferences.autoMask;autoMask.addEventListener('change',()=>void savePreferences({autoMask:autoMask.checked}));
  for(const input of document.querySelectorAll<HTMLInputElement>('input[name=theme]'))input.addEventListener('change',()=>void savePreferences({theme:input.value as ThemePreference}));

  const tab=await activeTab();if(!tab.ok)setStatus(tab.error.message,true);else{const probe=await probeRuntime(tab.data.id!);if(probe.kind==='compatible'){render(probe.state);if(JSON.stringify(probe.state.appearance)!==JSON.stringify(appearance))await send('SET_APPEARANCE',appearance)}else if(probe.kind==='stale'||probe.kind==='legacy')setStatus('Reload this page to update Soft Blackout.',true);else if(probe.kind==='unavailable')setStatus(probe.error.message,true)}
  chrome.runtime.onMessage.addListener((message)=>{if(message?.marker==='soft-blackout-state-changed')void activeTab().then(async tabResult=>{if(tabResult.ok){const result=await request(tabResult.data.id!,'GET_STATE',null);if(result.ok)render(result.data)}})});

  manual.addEventListener('click',async()=>{const active=manual.getAttribute('aria-pressed')==='true';if(!active&&current?.poetry.keptCount&&!confirm('Discard the pending Poetry composition and start Manual Mode?'))return;if(!active&&current?.poetry.keptCount)await send('DISCARD_POETRY',null);await send(active?'STOP_EDITING':'START_EDITING',active?null:{mode:'manual'} as never)});
  poetry.addEventListener('click',async()=>{const active=poetry.getAttribute('aria-pressed')==='true';await send(active?'STOP_EDITING':'START_POETRY',null as never)});
  element('applyPoetryBtn').addEventListener('click',()=>void send('APPLY_POETRY',null));element('clearPoetryBtn').addEventListener('click',()=>void send('CLEAR_POETRY',null));element('editPoetryBtn').addEventListener('click',()=>void send('EDIT_POETRY',null));element('cancelPoetryEditBtn').addEventListener('click',()=>void send('CANCEL_POETRY_EDIT',null));
  const selectedCategories=():PatternCategories=>({email:email.checked,url:url.checked,phone:phone.checked});const syncScan=()=>{scan.disabled=!email.checked&&!url.checked&&!phone.checked};syncScan();for(const checkbox of[email,url,phone])checkbox.addEventListener('change',async()=>{syncScan();await chrome.storage.local.set({[PATTERN_PREFERENCES_KEY]:selectedCategories()});if(current?.pattern.status!=='idle')await send('CANCEL_PATTERN_SCAN',null)});
  element('scanPatternsBtn').addEventListener('click',async()=>{if(current?.poetry.keptCount&&!confirm('Discard the pending Poetry composition and scan patterns?'))return;if(current?.poetry.keptCount)await send('DISCARD_POETRY',null);await send('SCAN_PATTERNS',selectedCategories())});element('applyPatternsBtn').addEventListener('click',()=>void send('APPLY_PATTERNS',null));element('cancelPatternBtn').addEventListener('click',()=>void send('CANCEL_PATTERN_SCAN',null));
  element('undoBtn').addEventListener('click',()=>void send('UNDO',null));element('redoBtn').addEventListener('click',()=>void send('REDO',null));element('resetRedactBtn').addEventListener('click',()=>{if(current&&(current.history.canUndo||current.pending)&&!confirm('Reset all masks and pending work on this page?'))return;void send('RESET',null)});
  document.body.dataset.ready='true';
});
