import {makeCanvas,canvasBlob,loadImage} from '../scripts/renderer.js';

export async function checkGuidedWorkflow({assert,rejects,SceneArchitectApp,settings,scenes,uploads,output,faults}) {
  const picker=foundry.applications.apps.FilePicker,oldBrowse=picker.browse,oldUpload=picker.upload;
  const originalFetch=globalThis.fetch,clipboard=navigator.clipboard.writeText;
  const files=[];
  const coastal=['Boat','Lantern','Rope','Barrel','Compass','Anchor','Net','Oar','Crate','Sail','Wheel','Bucket','Telescope','Desk','Shelf','Ladder','Chest','Tools','Candle','Winch'];
  const bedroom=['Bed','Pillow','Blanket','Wardrobe','Dresser','Mirror','Rug','Curtain','Slippers','Trunk','Cushion','Mattress','Nightstand','Basin','Screen','Quilt','Stool','Vanity','Bunk','Clothes'];
  const names=['Stone_Floor_Texture','Wall_Stone_Straight_Path',
    ...coastal.map(n=>`Lighthouse_${n}_1x1`),...bedroom.map(n=>`Bedroom_${n}_1x1`),
    ...['Anvil','Forge','Furnace','Hammer','Saw','Weapon','Sword','Spear','Shield','Armor','Rack','Chain','Cage','Machine','Altar','Statue','Pedestal','Fountain','Well','Urn','Vase','Plant','Flower','Tree','Bush','Boulder','Stalagmite','Crystal','Wagon','Cart','Wheel','Saddle','Hay','Trough','Saddlebag','Fence','Pillar','Column','Bedroll','Tent'].map(n=>`Workshop_${n}_1x1`)];
  for(const name of names) {
    const file=`guided-${name}.png`,canvas=makeCanvas(name.includes('Wall_')?64:16,16);
    const ctx=canvas.getContext('2d');ctx.fillStyle=name.includes('Wall_')?'#bd9b70':name.includes('Lantern')?'#ffd976':name.includes('Desk')?'#b77769':'#647c88';ctx.fillRect(0,0,canvas.width,canvas.height);
    await output(file,await canvasBlob(canvas));files.push(`output/${file}`);
  }
  picker.browse=async()=>({files,dirs:[]});
  picker.upload=async(...args)=>{const saved=await oldUpload(...args);return {...saved,path:saved.path.replace(/^\//,'')};};
  const waitFor=async predicate=>{
    for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}
    throw new Error('Guided workflow did not finish its action.');
  };
  let app;
  const input=(name,value)=>{
    const field=app.element.querySelector(`[name="${name}"]`);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));return field;
  };
  const button=action=>[...app.element.querySelectorAll(`[data-action="${action}"]`)].find(b=>b.checkVisibility());
  const click=async(action,{error=false}={})=>{
    const target=button(action);assert(target&&!target.disabled,`Guided ${action} is visible and enabled`);
    target.click();await waitFor(()=>!app.busy);
    if(!error)assert(!app.error,`Guided ${action} completes without an error`);
  };
  const snapshot=async name=>{
    const clone=app.element.cloneNode(true);
    for(const [i,field] of [...app.element.querySelectorAll('input,textarea')].entries()) {
      const copy=clone.querySelectorAll('input,textarea')[i];
      if(field.tagName==='TEXTAREA')copy.textContent=field.value;else copy.setAttribute('value',field.value);
    }
    for(const canvas of app.element.querySelectorAll('canvas')) {
      const image=document.createElement('img');image.src=canvas.toDataURL();image.style.cssText='display:block;width:100%;height:auto';image.alt=canvas.getAttribute('aria-label')??'Preview';
      clone.querySelectorAll('canvas')[0].replaceWith(image);
    }
    clone.style.cssText='width:min(760px,100%);margin:auto';
    await output(`guided-${name}.html`,new Blob([`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scene Architect - ${name}</title><link rel="stylesheet" href="../styles/scene-architect.css"><style>${document.querySelector('#browser-fixture-style').textContent}body{margin:0}*{box-sizing:border-box}</style></head><body>${clone.outerHTML}</body></html>`],{type:'text/html'}));
  };
  try {
    await rejects(()=>loadImage(files[0],{maxPixels:1}),/pixel.*budget/,'Shared loader enforces the remaining discovery pixel budget');
    const loadingController=new AbortController(),loading=loadImage(files[0],{signal:loadingController.signal});
    loadingController.abort();
    await rejects(()=>loading,/cancelled/,'Shared loader cancels an in-flight image request');
    settings.set('localDraft','');settings.set('assetCatalogue','');settings.set('assetRoot','');
    app=new SceneArchitectApp();await app.render();
    input('sceneName','Lighthouse');input('brief','An old lighthouse on a rocky coast, with warm lamps and a keeper workshop.');
    assert(app.workflow.palette.length===0,'Guided journey starts from an empty palette, not a prepared fixture');
    assert(app.element.querySelectorAll('[data-stage]:not([hidden])').length===1,'Only one primary workflow stage is exposed');
    assert([...app.element.querySelectorAll('.sa-primary')].filter(b=>b.checkVisibility()).length===1,'Fresh Describe has one visible primary action');
    assert(!app.element.querySelector('[data-field="confirmed"]'),'Fresh primary journey needs no per-asset confirmation');
    app.element.style.width='760px';
    const action=button('openSetup').getBoundingClientRect(),top=app.element.getBoundingClientRect().top;
    assert(action.bottom-top<750,'Describe primary action fits inside a 900x800 window including header allowance');
    await snapshot('describe');
    app.element.style.width='320px';
    assert(app.element.scrollWidth<=app.element.clientWidth,'Describe reflows at 320px without horizontal overflow');
    app.element.style.width='';
    await click('openSetup');assert(document.activeElement.name==='assetRoot','Library setup moves keyboard focus to its path');
    await click('chooseAssetRoot');
    assert(faults.pickerOptions.type==='folder'&&app.element.querySelector('[name="assetRoot"]').value==='output','Native folder picker callback supplies the one-time library path');
    await click('indexLibrary');
    assert(document.activeElement.id==='sa-describe-title','Completed connection restores focus to the Describe stage');
    assert(settings.get('assetCatalogue')&&app.catalogue.entries.length===82,'One connection indexes the whole non-demo fixture catalogue');
    assert(app.element.querySelector('[name="brief"]').value.includes('rocky coast'),'Library connection preserves the typed brief');
    navigator.clipboard.writeText=async()=>{throw new Error('Injected clipboard denial');};
    await click('copyLayoutPrompt');
    assert(app.status.startsWith('Clipboard unavailable')&&app.element.querySelector('[data-asset-prompt] textarea').value.includes('requestId'),'Clipboard denial retains inline request text, without a modal');
    navigator.clipboard.writeText=clipboard;
    const request=structuredClone(app.workflow.assetRequest);
    assert(request.palette.length<=36&&request.palette.length>2,'Automatic preparation returns a bounded useful shortlist');
    assert(request.palette.every(a=>!a.confirmed&&a.calibration?.source==='automatic'),'Automatic preparation never fabricates human calibration confirmation');
    assert(document.activeElement.name==='responseText','Request preparation advances keyboard focus to the response');
    input('responseText','not JSON');await click('acceptDesign',{error:true});
    assert(!app.plan&&app.element.querySelector('[name="responseText"]').value==='not JSON','Invalid JSON remains editable without replacing a valid plan');
    assert(app.element.querySelector('[name="responseText"]').getAttribute('aria-invalid')==='true','Rejected response exposes its invalid state and recovery help');
    assert(app.element.querySelector('[data-status]').getAttribute('role')==='alert','Action errors use an explicit alert region');
    await snapshot('error');
    const material=request.palette.find(a=>a.kind==='material'),wall=request.palette.find(a=>a.kind==='wall');
    const lantern=request.palette.find(a=>a.kind==='prop'&&a.label.includes('Lantern')),desk=request.palette.find(a=>a.kind==='prop'&&a.label.includes('Desk'));
    assert(lantern&&desk,'The automatically selected lighthouse palette includes lighting and useful furnishings');
    const reply={requestId:request.id,plan:{version:1,scene:request.scene,assetScene:{version:1,surroundAsset:material.id,wallAsset:wall.id},
      spaces:[{id:'keeper',name:'Keeper room',x:2,y:2,width:12,height:10,floorAsset:material.id,floor:'stone'}],
      openings:[{x:7,y:12,orientation:'h',length:1,kind:'door'}],barriers:[],
      features:[{id:'keeper-lamp',assetId:lantern.id,type:'lamp',roomId:'keeper',x:4,y:4,width:lantern.width,height:lantern.height,rotation:0,layer:'prop',description:'Keeper lamp'},
        {id:'keeper-desk',assetId:desk.id,type:'desk',roomId:'keeper',x:7,y:5,width:desk.width,height:desk.height,rotation:0,layer:'prop',description:'Keeper desk'}],
      lights:[{name:'Keeper lamp',preset:'steady-lamp',sourceFeatureId:'keeper-lamp',dim:6,bright:2}]}};
    input('responseText',JSON.stringify({...reply,requestId:'old'}));await click('acceptDesign',{error:true});
    assert(!app.plan&&app.status.includes('different request'),'Guided route rejects stale response identities');
    input('responseText',JSON.stringify(reply));
    const nativeCount=scenes.size,uploadCount=uploads.length;
    await click('acceptDesign');
    assert(app.workflow.built&&app.preview&&scenes.size===nativeCount&&uploads.length===uploadCount,'One validation action builds and renders without creating documents or uploads');
    assert([...app.element.querySelectorAll('.sa-primary')].filter(b=>b.checkVisibility()).length===1,'Preview has one visible primary action');
    assert(document.activeElement.id==='sa-preview-title','Completed preview receives stage-heading keyboard focus');
    await snapshot('preview');
    app.element.style.width='320px';
    assert(app.element.scrollWidth<=app.element.clientWidth,'Preview reflows at 320px without horizontal overflow');
    app.element.style.width='';
    await click('createScene',{error:true});
    assert(scenes.size===nativeCount&&app.status.includes('Inspect'),'Guided creation still requires exact-preview inspection');
    app.element.querySelector('[name="artworkReviewed"]').click();await click('createScene');
    const saved=app.scene;
    assert(saved&&scenes.size===nativeCount+1&&uploads.length===uploadCount+1,'Guided creation saves one PNG and a native scene');
    assert(saved.lights.length===1&&saved.walls.some(w=>w.door===1)&&app.plan.features.length===2,'Fresh automatic workflow creates furnishings, a visible-source native light and an interactive door');
    assert(saved.getFlag('scene-architect','plan').assetScene.palette.every(a=>a.calibration),'Saved scene preserves automatic metadata provenance');

    await app.newProject();app.catalogue=null;
    input('sceneName','Bedroom');input('brief','A comfortable bedroom with bedding, wardrobes and a dressing area.');
    await click('copyLayoutPrompt');
    const second=app.workflow.assetRequest.palette;
    const count=(palette,word)=>palette.filter(a=>a.label.toLowerCase().includes(word)).length;
    assert(count(second,'bedroom')>count(request.palette,'bedroom')&&count(request.palette.slice(0,12),'lighthouse')>count(second.slice(0,12),'lighthouse'),'Contrasting briefs retrieve different, appropriately prioritized candidates from an oversubscribed library');
    assert(app.catalogue.entries.length===82,'Later projects automatically load the shared catalogue without reconnecting');

    await app.newProject();input('brief','An old lighthouse');app.catalogue=null;
    let release,entered=false;
    globalThis.fetch=async(...args)=>{if(String(args[0])===settings.get('assetCatalogue')){entered=true;await new Promise(r=>release=r);}return originalFetch(...args);};
    button('copyLayoutPrompt').click();await waitFor(()=>entered);
    input('brief','A different bedroom');release();await waitFor(()=>!app.busy);
    assert(!app.workflow.assetRequest&&app.status.includes('changed during preparation'),'Changed input cannot receive a stale asynchronously prepared request');
    globalThis.fetch=originalFetch;

    await app.newProject();app.catalogue=null;entered=false;
    globalThis.fetch=async(...args)=>{if(String(args[0])===settings.get('assetCatalogue')){entered=true;await new Promise(r=>release=r);}return originalFetch(...args);};
    button('copyLayoutPrompt').click();await waitFor(()=>entered);
    const cancel=button('cancelIndex');assert(cancel&&!cancel.disabled,'Cancellation stays usable while preparation is busy');
    cancel.click();release();await waitFor(()=>!app.busy);
    assert(!app.workflow.assetRequest&&settings.get('assetCatalogue')&&!app.error&&app.status.includes('cancelled'),'Cancelled preparation retains the catalogue and reports cancellation, not an error or new request');
    globalThis.fetch=originalFetch;

    await app.newProject();await click('copyLayoutPrompt');
    const entry=app.workflow.palette[0];
    app.element.querySelector(`[data-palette-id="${entry.id}"] [data-field="width"]`).dispatchEvent(new Event('input'));
    assert(!app.workflow.palette[0].calibration&&!app.workflow.assetRequest,'Editing a manual override clears automatic readiness and the trusted request');

    await app.newProject();app.catalogue={...app.catalogue,entries:app.catalogue.entries.filter(a=>a.src.includes('Bedroom_'))};
    await click('copyLayoutPrompt',{error:true});
    assert(!app.workflow.assetRequest&&/material|wall|library/i.test(app.status),'An unusable library gives explicit role/setup recovery, never a placeholder palette');
    assert([...app.element.querySelectorAll('button[data-busy-disabled]')].length===0,'Failed operations restore only controls disabled by their busy state');
    app.element.querySelector('[name="projectId"]').value=saved.id;await app.reopen();app.catalogue=null;await app.previewArtwork();
    assert(app.preview&&app.plan.assetScene.palette.length===request.palette.length,'Automatic saved projects render without catalogue loading');
    app.busy=true;app.syncBusyControls();app.invalidate('Injected edit during an operation');app.busy=false;app.syncBusyControls();
    assert([...app.element.querySelectorAll('[data-commit]')].every(b=>b.disabled),'Busy cleanup cannot re-enable saving after an intervening preview invalidation');
    await app.previewArtwork();
    const native=JSON.stringify([saved.walls,saved.lights,saved.tiles]);
    app.element.querySelector('[name="artworkReviewed"]').click();await click('updateScene');
    assert(JSON.stringify([saved.walls,saved.lights,saved.tiles])===native,'Automatic background updates preserve native documents');
    await snapshot('saved');
  } finally {
    picker.browse=oldBrowse;picker.upload=oldUpload;globalThis.fetch=originalFetch;navigator.clipboard.writeText=clipboard;
    if(app?.element)app.element.style.width='';
  }
}
