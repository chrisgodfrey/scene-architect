import {createAssetRequest,importAssetResponse} from '../scripts/asset-plan.js';

export function assetFixture(prefix='assets/') {
  const palette=[
    {id:'floor',kind:'material',width:2,height:2,pixelWidth:64,pixelHeight:64},
    {id:'wall',kind:'wall',width:4,height:1,pixelWidth:128,pixelHeight:32},
    {id:'desk',kind:'prop',width:2,height:1,pixelWidth:64,pixelHeight:32},
    {id:'lamp',kind:'prop',width:1,height:1,pixelWidth:32,pixelHeight:32}
  ].map(a=>({...a,src:`${prefix}asset-fixture-${a.id}.png`,label:a.id,anchorY:.5,confirmed:true}));
  const form={sceneName:'Asset test',columns:12,rows:9,gridSize:50,brief:'Connected offset study rooms.'};
  const request=createAssetRequest(form,palette,'asset-test-request');
  const response={requestId:request.id,plan:{
    version:1,scene:request.scene,assetScene:{version:1,surroundAsset:'floor',wallAsset:'wall'},
    spaces:[{id:'west',name:'West study',x:1,y:1,width:5,height:5,floorAsset:'floor'},{id:'east',name:'East study',x:6,y:2,width:5,height:4,floorAsset:'floor'}],
    openings:[{x:6,y:3,orientation:'v',length:1,kind:'door'},{x:3,y:6,orientation:'h',length:1,kind:'door'}],barriers:[],
    features:[{id:'desk-west',assetId:'desk',type:'desk',description:'Desk',x:2,y:3,width:2,height:1,roomId:'west',layer:'prop'},
      {id:'lamp-east',assetId:'lamp',type:'lamp',description:'Lamp',x:8,y:3,width:1,height:1,roomId:'east',layer:'prop'}],
    lights:[{name:'Desk lamp',preset:'steady-lamp',sourceFeatureId:'lamp-east',dim:10,bright:5}]
  }};
  return {palette,form,request,response,plan:importAssetResponse(JSON.stringify(response),request)};
}
