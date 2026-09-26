import {assetFixture} from './asset-fixture.js';
import {renderAssetScene} from '../scripts/asset-renderer.js';
import {makeCanvas,canvasBlob} from '../scripts/renderer.js';

export async function checkAssetWorkflow({assert,rejects,SceneArchitectApp,settings,scenes,uploads,review,output,setDialog}) {
  const {palette,plan,form,response}=assetFixture('output/');
  const images=new Map();
  for(const a of palette) {
    const c=makeCanvas(a.pixelWidth,a.pixelHeight),ctx=c.getContext('2d');
    if(a.kind==='material'){ctx.fillStyle='#596c7a';ctx.fillRect(0,0,c.width,c.height);}
    else if(a.kind==='wall'){ctx.fillStyle='#ab8a68';ctx.fillRect(0,c.height/4,c.width,c.height/2);}
    else {ctx.fillStyle=a.id==='lamp'?'#ffffee':'#bd4433';ctx.fillRect(c.width/4,c.height/4,c.width/2,c.height/2);}
    images.set(a.src,c);await output(`asset-fixture-${a.id}.png`,await canvasBlob(c));
  }
  let loads=0;
  const loader=async src=>{loads++;return images.get(src);};
  const rendered=await renderAssetScene(plan,{imageLoader:loader});
  const pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  assert(loads===4,'Asset renderer decodes each used source once');
  assert(same(pixel(rendered.canvas,75,75),[89,108,122,255]),'Asset floor repeats at the reviewed material scale');
  assert(pixel(rendered.wallLayer,50,150)[3]===255&&pixel(rendered.wallLayer,300,175)[3]===0,'Wall strip covers native solid line and leaves exact native door aperture clear');
  assert(same(pixel(rendered.canvas,150,175),[189,68,51,255])&&same(pixel(rendered.canvas,102,152),[89,108,122,255]),'Prop full-frame alpha padding is preserved without trimming or stretching');
  const bytes=async canvas=>Array.from(new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer()));
  assert(same(await bytes(rendered.canvas),await bytes((await renderAssetScene(plan,{imageLoader:loader})).canvas)),'Repeated asset render produces byte-identical PNG');
  const corner=structuredClone(plan);corner.openings.push({x:1,y:1,orientation:'h',length:1,kind:'open'});
  assert(pixel((await renderAssetScene(corner,{imageLoader:loader})).wallLayer,50,50)[3]===0,'Corner aperture clears perpendicular wall-strip end caps');
  const secret=structuredClone(plan);secret.openings[0].kind='secret';
  assert(pixel((await renderAssetScene(secret,{imageLoader:loader})).wallLayer,300,175)[3]===255,'Secret door retains matching wall appearance');
  await rejects(()=>renderAssetScene(plan,{imageLoader:async()=>{throw new Error('Injected decode failure');}}),/decode failure/,'Asset decode failure is explicit, never a placeholder success');
  await rejects(()=>renderAssetScene(plan,{imageLoader:async()=>makeCanvas(1,1)}),/dimensions changed/,'Changed asset dimensions require recalibration');
  const large=structuredClone(plan);Object.assign(large.assetScene.palette[0],{pixelWidth:6000,pixelHeight:6000});
  Object.assign(large.assetScene.palette[1],{pixelWidth:12000,pixelHeight:3000});
  await rejects(()=>renderAssetScene(large,{imageLoader:loader}),/decode budget/,'Aggregate decoded-image budget is enforced before image loading');

  const picker=foundry.applications.apps.FilePicker,oldBrowse=picker.browse,oldUpload=picker.upload;
  picker.browse=async()=>({files:palette.map(a=>a.src),dirs:[]});
  picker.upload=async(...args)=>{const saved=await oldUpload(...args);return {...saved,path:saved.path.replace(/^\//,'')};};
  try {
    settings.set('localDraft','');const app=new SceneArchitectApp();await app.render();
    assert(app.workflow.mode==='assets'&&app.workflow.assetSelection==='automatic','New projects default to automatic server asset selection');
    await app.openSetup();
    app.element.querySelector('[name="assetRoot"]').value=' ';
    await rejects(()=>app.indexLibrary(),/Choose an asset folder/,'Blank asset root never indexes the entire Foundry Data directory');
    const brief=app.element.querySelector('[name="brief"]');brief.value='Describe before choosing assets';brief.dispatchEvent(new Event('input'));
    app.element.querySelector('[name="assetRoot"]').value='output';
    await app.indexLibrary();
    assert(app.catalogue.entries.length===4&&settings.get('assetCatalogue'),'UI indexes and publishes a shared server catalogue');
    assert(app.element.querySelector('[name="brief"]').value===brief.value,'Asset library redraw preserves the entered design brief');
    app.catalogue=null;await app.loadLibrary();
    assert(app.catalogue.entries.length===4,'UI loads catalogue from server storage instead of relying on client draft');
    app.element.querySelector('[name="assetSearch"]').value='wall';await app.searchLibrary();
    const wall=app.searchResults.find(a=>a.src.endsWith('wall.png'));await app.addPaletteAsset({dataset:{id:wall.id}});
    assert(!app.workflow.palette[0].confirmed,'Discovered assets require explicit calibration confirmation');
    const card=app.element.querySelector('[data-palette-id]');
    card.querySelector('[data-field="kind"]').value='wall';card.querySelector('[data-field="width"]').value='4';
    card.querySelector('[data-field="confirmed"]').checked=true;await app.applyPalette();
    assert(app.workflow.palette[0].height===1&&app.workflow.palette[0].confirmed,'Palette calibration preserves decoded aspect ratio and review state');
    const ids=new Map(palette.map(a=>[a.id,app.catalogue.entries.find(e=>e.src===a.src).id]));
    app.workflow.palette=palette.map(a=>({...a,id:ids.get(a.id)}));Object.assign(app.workflow,form);await app.render();
    await app.copyLayoutPrompt();
    const write=navigator.clipboard.writeText;
    try {
      navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied for asset test');};
      await app.copyLayoutPrompt();
      assert(app.status.startsWith('Clipboard unavailable')&&app.element.querySelector('[data-asset-prompt] textarea'),'Asset clipboard failure displays a manual request without claiming it was copied');
    } finally {navigator.clipboard.writeText=write;}
    const request=app.workflow.assetRequest;
    assert(request.palette.length===4&&app.element.querySelector('[data-asset-prompt] textarea'),'Copied asset request has a durable trusted palette snapshot and manual text fallback');
    const reply=structuredClone(response);reply.requestId=request.id;
    reply.plan.assetScene.surroundAsset=ids.get('floor');reply.plan.assetScene.wallAsset=ids.get('wall');
    reply.plan.spaces.forEach(r=>r.floorAsset=ids.get('floor'));
    reply.plan.features.forEach(f=>f.assetId=ids.get(f.assetId));
    const setResponse=json=>{app.element.querySelector('[name="responseText"]').value=json;};
    setResponse(JSON.stringify({...reply,requestId:'stale'}));
    await rejects(()=>app.pastePlan(),/different request/,'Stale model response is rejected without importing a plan');
    assert(!app.plan&&app.workflow.assetRepair,'Rejected asset JSON retains a repair request and leaves prior state intact');
    await app.copyPlanRepairPrompt();
    app.element.querySelector('[name="columns"]').value='13';setResponse(JSON.stringify(reply));
    await rejects(()=>app.pastePlan(),/changed/,'Changed form dimensions invalidate the pending response');
    app.element.querySelector('[name="columns"]').value='12';
    await app.pastePlan();await app.buildPlan();const count=scenes.size,uploadCount=uploads.length;
    await app.previewArtwork();
    assert(scenes.size===count&&uploads.length===uploadCount,'Asset import/build/render makes no native documents or image uploads');
    const expected=await bytes(app.preview.canvas);review(app);await app.createScene();const scene=app.scene;
    assert(uploads.length===uploadCount+1&&app.workflow.map.kind==='assets'&&app.workflow.map.src===null,'Asset scene saves one rendered PNG, not a generated source image');
    assert(same(expected,Array.from(new Uint8Array(await uploads.at(-1).arrayBuffer()))),'Asset scene uploads the exact inspected PNG');
    assert(scene.flags['scene-architect'].plan.assetScene.palette.length===4&&scene.flags['scene-architect'].plan.art===undefined,'Native scene retains calibrated palette and bypasses legacy art migration');
    const native=JSON.stringify([scene.walls,scene.lights]);await app.close();settings.set('localDraft','');
    const reopened=new SceneArchitectApp();await reopened.render();reopened.element.querySelector('[name="projectId"]').value=scene.id;
    await reopened.reopen();await reopened.previewArtwork();
    assert(reopened.workflow.mode==='assets'&&same(await bytes(reopened.preview.canvas),expected),'Another client can reopen and reproduce the asset render without a loaded catalogue');
    review(reopened);await reopened.updateScene();
    assert(JSON.stringify([scene.walls,scene.lights])===native,'Asset artwork updates preserve every native wall and light document');
    assert([...reopened.element.querySelectorAll('input,select,textarea')].every(e=>e.closest('label')||e.getAttribute('aria-label')),'New asset form controls have explicit labels');
    await reopened.close();
  } finally {picker.browse=oldBrowse;picker.upload=oldUpload;setDialog(null);}
}
