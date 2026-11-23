import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const ROOT = "https://d2ol7oe51mr4n9.cloudfront.net/user_3LxvA5Gl3ZgqPX9FeucXcTI5fjL/";
const M = {
 "a-entry":"c89520ed-541c-4659-95cb-3724668f274e",
 "a-bedroom":"c1636123-5874-4db0-af82-73e893365324",
 "a-bath":"468be9aa-b8bb-4457-ad8f-a8b0078d9da0",
 "a-lounge":"406f95c6-4897-42c2-af11-5e01f70133c5",
 "a-dining":"f26e0ed9-1801-436b-86a2-0088eb0f5e6d",
 "a-kitchen":"8a0e4981-c562-4e5b-a4b1-c97894529dea",
 "b-living":"a678001c-4075-43e0-971b-60ff4fcb9921",
 "b-bedroom":"6901a6ff-15c6-43cf-a7d2-406ed9f4cd62",
 "b-exterior":"1358f0ca-ad54-4f1a-9602-cd2823f4c23a",
 "b-kitchen":"68f5a4b1-cd3d-4420-94d8-3a45b7f3c23e",
 "b-bedroom2":"20129224-2c46-4e91-8fc6-423c0987aad2",
 "b-bath":"f67f683d-0884-45a4-b0b7-e423a2a1b989",
 "b-bedroom3":"d4a4c20f-423d-42eb-88d9-f97f903c7348",
 "b-courtyard":"38d1f995-eea3-4bfe-8054-2820768a2469",
 "s-a-lounge":"0653fd5b-4d27-4c37-9763-748114adba57",
 "s-a-bath":"ed3e968a-5e65-4ff7-aba0-6e7231e895bc",
 "s-b-living":"6767f77f-4283-439a-bfdc-1a2c022144f8",
 "s-b-kitchen":"a17e1394-e42e-4732-894e-943ee79f8108",
 "s-b-bath":"1a328f2c-eb16-4d1c-869e-566637b539b4"
};
const jpg = id => ROOT + M[id] + ".jpg";
const V = {
 a: ROOT+"e5c0a834-e8e8-4eb3-b44c-99673a8cf3d9.mp4",
 b: ROOT+"72057776-0ea9-43bb-aac8-093fa6a0aede.mp4"
};
const properties = [
 {id:"a",name:"Residence study 01",short:"The red-sofa residence",description:"An intimate home with a luminous sitting room, tiled bathroom and welcoming private spaces.",video:V.a,start:3,
 rooms:[
  {id:"a-entry",name:"Entrance & passage",kind:"hall",desc:"The connecting corridor",t:0.5,x:-1.55,z:0.25,w:2.1,d:4.7},
  {id:"a-bedroom",name:"Sleeping room",kind:"bed",desc:"Natural light and quiet corners",t:5.8,x:-4.5,z:-2.45,w:3.8,d:3.1},
  {id:"a-bath",name:"Bathroom",kind:"bath",desc:"Blue-and-white tilework",t:12.3,x:-4.5,z:1.1,w:3.8,d:3.1,sweep:"s-a-bath"},
  {id:"a-lounge",name:"Living room",kind:"lounge",desc:"Red seating and generous light",t:23.7,x:2.1,z:-0.95,w:5.2,d:5.0,sweep:"s-a-lounge"},
  {id:"a-dining",name:"Dining area",kind:"dining",desc:"A place to gather",t:31.9,x:-1.10,z:4.0,w:2.9,d:2.55},
  {id:"a-kitchen",name:"Kitchen",kind:"kitchen",desc:"Bright utilitarian space",t:37.3,x:2.55,z:4.0,w:4.1,d:2.55}
 ]},
 {id:"b",name:"Residence study 02",short:"The tiled-floor residence",description:"An airy family property with bright bedrooms, a practical kitchen and wide exterior outlooks.",video:V.b,start:0,
 rooms:[
  {id:"b-living",name:"Living area",kind:"lounge",desc:"A sunny room with city views",t:1.4,x:-2.8,z:-2.2,w:4.6,d:4.0,sweep:"s-b-living"},
  {id:"b-bedroom",name:"Window bedroom",kind:"bed",desc:"An inviting private room",t:7.2,x:2.1,z:-2.2,w:3.9,d:4.0},
  {id:"b-exterior",name:"Neighborhood view",kind:"exterior",desc:"An outlook across the district",t:12,x:5.65,z:-2.2,w:2.0,d:2.5},
  {id:"b-kitchen",name:"Kitchen",kind:"kitchen",desc:"Open counters and storage",t:21.5,x:-2.8,z:1.7,w:4.6,d:3.25,sweep:"s-b-kitchen"},
  {id:"b-bedroom2",name:"Twin bedroom",kind:"bed",desc:"Comfortable sleeping area",t:31,x:2.1,z:1.7,w:3.9,d:3.25},
  {id:"b-bath",name:"Bathroom",kind:"bath",desc:"Blue tile and clean lines",t:38.7,x:-3.65,z:5.0,w:2.8,d:3.1,sweep:"s-b-bath"},
  {id:"b-bedroom3",name:"Second sleeping room",kind:"bed",desc:"Additional private bedroom",t:44.1,x:0.1,z:5.0,w:4.0,d:3.1},
  {id:"b-courtyard",name:"Courtyard outlook",kind:"exterior",desc:"View over the buildings",t:55,x:3.95,z:5.0,w:2.3,d:3.1}
 ]}
];
const $ = id => document.getElementById(id);
const ease = t => 1 - Math.pow(1-t,3);
let selectedProperty=0, selectedRoom=properties[0].start, mode="3d";
let renderer,scene,camera,controls,world,raycaster,mouse,hitTargets=[],roomMeshes=[],roomPins=[];
let flight=null,flyToken=0,ready=false,interactive=true,dragAmount=0,pointerStart=null;
const texLoader=new THREE.TextureLoader();texLoader.crossOrigin="anonymous";
const images={};
const imageTex = id => {
 if(images[id])return images[id];
 const t=texLoader.load(jpg(id),()=>{},undefined,()=>{});
 t.colorSpace=THREE.SRGBColorSpace;
 t.anisotropy=4;
 images[id]=t;
 return t;
};
const prop=()=>properties[selectedProperty];
const room=()=>prop().rooms[selectedRoom];
const mat=(c,extra={})=>new THREE.MeshStandardMaterial({color:c,roughness:.83,metalness:0,...extra});
const $bg=()=>$("roomPhoto");
let toastTimer=null;
function toast(t){const el=$("notification");el.textContent=t;el.classList.remove("isHidden");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add("isHidden"),3400)}
function updateHash(){history.replaceState(null,"",location.pathname+location.search+"#tour-"+(selectedProperty+1))}
function cardSvg(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>'}
function renderPanel(){
 $("propertyTitle").textContent=prop().name;
 $("propertyDesc").textContent=prop().description;
 $("propertyPickerName").textContent=prop().short;
 document.querySelector(".propertyNumber").textContent=String(selectedProperty+1).padStart(2,"0");
 $("roomCount").textContent=prop().rooms.length+" stops";
 $("roomList").innerHTML=prop().rooms.map((r,i)=>'<button class="roomCard '+(i===selectedRoom?"active":"")+'" data-room="'+i+'" aria-label="Visit '+r.name+'"><img class="thumb" src="'+jpg(r.id)+'" loading="lazy" alt=""><span class="roomInfo"><span class="roomNumber">SPACE '+String(i+1).padStart(2,"0")+'</span><span class="roomName">'+r.name+'</span><span class="roomMeta">'+r.desc+'</span></span><span class="roomArrow">↗</span></button>').join("");
 $("roomList").querySelectorAll("[data-room]").forEach(b=>b.onclick=()=>pickRoom(Number(b.dataset.room),true));
}
function renderPhoto(){
 const r=room(),sweep=r.sweep;
 const img=$("roomPhoto"),url=jpg(sweep||r.id);
 img.style.opacity="0.08";
 img.onload=()=>{img.style.opacity="1";img.classList.toggle("widePhoto",!!sweep)};
 img.onerror=()=>{if(sweep){img.onerror=null;img.src=jpg(r.id)}else toast("Photo unavailable; try another room")};
 img.src=url;
 $("photoBackdrop").style.backgroundImage='url("'+url+'")';
 $("photoCoverage").textContent=sweep?"CPU-stitched partial room sweep · Not full 360°":"Original video frame · Limited captured angle";
 dragAmount=0;img.style.transform="translateX(0px) scale(1)";
}
function renderHero(){
 if(mode==="3d"){
   $("modeHint").textContent="EXPLORE IN 3D";
   $("heroTitle").textContent=prop().name;
   $("heroText").textContent="Orbit, zoom and tap a room to enter.";
 } else if(mode==="photo"){
   $("modeHint").textContent="INSIDE THE PROPERTY · "+String(selectedRoom+1).padStart(2,"0")+"/"+String(prop().rooms.length).padStart(2,"0");
   $("heroTitle").textContent=room().name;
   $("heroText").textContent=room().desc+" · Drag to inspect the captured view";
 } else {
   $("modeHint").textContent="SPATIAL NAVIGATION";
   $("heroTitle").textContent="See how it connects.";
   $("heroText").textContent="A conceptual layout. Select a room to enter.";
 }
}
function setMode(next){
 mode=next;
 $("glScene").classList.toggle("isHidden",mode!=="3d");
 $("photoStage").classList.toggle("isHidden",mode!=="photo");
 $("planStage").classList.toggle("isHidden",mode!=="plan");
 $("modelGuide").classList.toggle("isHidden",mode!=="3d");
 $("photoPrev").classList.toggle("isHidden",mode!=="photo");
 $("photoNext").classList.toggle("isHidden",mode!=="photo");
 $("photoIndicator").classList.toggle("isHidden",mode!=="photo");
 $("resetCamera").classList.toggle("isHidden",mode!=="3d");
 document.querySelectorAll("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
 $("statusLine").textContent=mode==="3d"?"Orbitable spatial concept · Estimated geometry, not a scanned model":mode==="photo"?"Real client footage · Partial captured angles · No invented 360° view":"Illustrative plan only · No measured dimensions available";
 renderHero();
 if(mode==="plan")renderPlan();
 if(mode==="photo")renderPhoto();
 if(mode==="3d")resize();
}
function selectRoom(i){selectedRoom=(i+prop().rooms.length)%prop().rooms.length;renderPanel();renderHero();if(mode==="photo")renderPhoto();if(mode==="plan")renderPlan();highlightRoom()}
function pickRoom(i,enter=true){
 ++flyToken;
 if(mode==="3d"&&renderer&&camera){
  selectRoom(i);
  flyToIndex(i,enter);
 }else{
  selectRoom(i);
  if(enter)setMode("photo");
 }
}
function selectProperty(i){
 ++flyToken;flight=null;
 selectedProperty=i;selectedRoom=prop().start;renderPanel();
 render3DHouse();renderPlan();renderPhoto();resetCamera();
 setMode("3d");updateHash();$("propertyModal").classList.add("isHidden");
 toast("Property "+String(i+1).padStart(2,"0")+" loaded");
}
function openPicker(){
 const holder=$("propertyCards");
 holder.innerHTML=properties.map((p,i)=>'<button class="propertyChoice '+(i===selectedProperty?"active":"")+'" data-property="'+i+'"><img src="'+jpg(p.rooms[p.start].id)+'" alt=""><b>'+p.name+'</b><small>'+p.short+'</small></button>').join("");
 holder.querySelectorAll("[data-property]").forEach(b=>b.onclick=()=>selectProperty(Number(b.dataset.property)));
 $("propertyModal").classList.remove("isHidden");
}
function renderPlan(){
 const rooms=prop().rooms;
 const minX=Math.min(...rooms.map(r=>r.x-r.w/2))-0.5,maxX=Math.max(...rooms.map(r=>r.x+r.w/2))+0.5;
 const minZ=Math.min(...rooms.map(r=>r.z-r.d/2))-0.5,maxZ=Math.max(...rooms.map(r=>r.z+r.d/2))+0.5;
 const scale=Math.min(690/(maxX-minX),450/(maxZ-minZ));
 const offsetX=400-(minX+maxX)/2*scale,offsetZ=278-(minZ+maxZ)/2*scale;
 const snap=v=>Math.round(v*10)/10;
 $("planSvg").innerHTML='<rect x="6" y="6" width="788" height="548" fill="none" stroke="#c5c8bd" stroke-dasharray="5 7" rx="12"/>'+rooms.map((r,i)=>{
   const x=snap((r.x-r.w/2)*scale+offsetX), y=snap((r.z-r.d/2)*scale+offsetZ),w=snap(r.w*scale),h=snap(r.d*scale);
   const roomName=r.name.length>18?r.name.split(" ").slice(0,2).join(" "):r.name;
   return '<g class="planRoom '+(i===selectedRoom?"active":"")+'" data-room="'+i+'"><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+(r.kind==="bath"?"#b6cfd1":r.kind==="exterior"?"#bed4bb":"#f1eee6")+'" stroke="#7c8d79" stroke-width="2.2"/><text class="planLabel" x="'+(x+w/2)+'" y="'+(y+h/2-3)+'">'+roomName+'</text><text class="planSub" x="'+(x+w/2)+'" y="'+(y+h/2+14)+'">VIEW '+String(i+1).padStart(2,"0")+'</text></g>';
 }).join("")+'<text x="400" y="539" fill="#738174" font-size="11" text-anchor="middle">SCHEMATIC ROOM RELATIONSHIPS · NOT TO SCALE</text>';
 $("planSvg").querySelectorAll("[data-room]").forEach(g=>g.addEventListener("click",()=>pickRoom(Number(g.dataset.room),true)));
}
function addBox(parent,w,h,d,x,y,z,color,options={}){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.01,w),Math.max(.01,h),Math.max(.01,d)),mat(color,options));
 mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function addCylinder(parent,radius,height,x,y,z,color){
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,20),mat(color));
 mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;
}
function addSofa(group,x,z,rotation,color){
 const g=new THREE.Group();g.position.set(x,.18,z);g.rotation.y=rotation;group.add(g);
 addBox(g,1.7,.28,.62,0,.34,0,color);
 addBox(g,1.7,.55,.22,0,.61,-.35,color);
 addBox(g,.18,.4,.65,-.82,.55,0,color);
 addBox(g,.18,.4,.65,.82,.55,0,color);
 for(const dx of [-.51,.02,.52])addBox(g,.44,.13,.40,dx,.52,.08,color);
 for(const dx of [-.52,.5])addBox(g,.35,.18,.14,dx,.83,-.25,"#efe4cf");
}
function addBed(group,x,z,w=1.5,rotation=0){
 const g=new THREE.Group();g.position.set(x,.15,z);g.rotation.y=rotation;group.add(g);
 addBox(g,w,.27,1.9,0,.3,0,"#9b8c7a");
 addBox(g,w-.1,.20,1.7,0,.49,.03,"#e9e2d9");
 addBox(g,w-.15,.05,1.16,0,.62,.27,"#bcc9b5");
 addBox(g,w+.05,.7,.12,0,.58,-.99,"#a58d79");
 addBox(g,w*.40,.13,.31,-w*.22,.64,-.64,"#f9f7ef");
 addBox(g,w*.40,.13,.31,w*.22,.64,-.64,"#f9f7ef");
}
function addTable(group,x,z){
 const g=new THREE.Group();g.position.set(x,.14,z);group.add(g);
 addBox(g,1.27,.09,.85,0,.74,0,"#a58d71");
 for(const dx of [-.49,.49])for(const dz of [-.33,.33])addBox(g,.08,.69,.08,dx,.37,dz,"#927558");
 for(const dz of [-.73,.73]){addBox(g,.56,.10,.47,0,.47,dz,"#ccbda2");addBox(g,.08,.51,.07,0,.36,dz,"#af8d70")}
}
function addKitchen(group,r){
 const g=new THREE.Group();g.position.set(r.x,.17,r.z);group.add(g);
 const k=r.w;
 addBox(g,k-.55,.78,.52,0,.44,-r.d/2+.42,"#e6e5de");
 addBox(g,k-.55,.09,.62,0,.87,-r.d/2+.38,"#555e5a");
 for(let j=-1;j<=1;j++)addBox(g,.76,.69,.025,j*(k-.7)/3,.43,-r.d/2+.74,"#b5b7ad");
 addBox(g,.65,.025,.44,-k/4,.93,-r.d/2+.35,"#2f3837");
 addCylinder(g,.15,.018,-k/4,.94,-r.d/2+.35,"#0f1815");
 addBox(g,.8,.62,.34,r.w/2-.48,.54,-.05,"#ecebe5");
}
function addBath(group,r){
 const g=new THREE.Group();g.position.set(r.x,.18,r.z);group.add(g);
 addBox(g,1.0,.20,.8,-r.w*.19,.19,-r.d*.15,"#fafdfa");
 addBox(g,.18,.42,.19,-r.w*.19,.47,-r.d*.15,"#fafdfa");
 addBox(g,.52,.7,.45,r.w*.22,.37,r.d*.2,"#f2f7f5");
 addBox(g,.58,.11,.46,r.w*.22,.76,r.d*.20,"#f2f7f5");
 addBox(g,1.2,.09,.09,-r.w*.05,.85,r.d/2-.22,"#8caeb4");
}
function addExterior(group,r){ const g=new THREE.Group();g.position.set(r.x,0,r.z);group.add(g);
 for(const dz of [-r.d*.42,r.d*.42])addBox(g,r.w,.06,.065,0,1.0,dz,"#647c6c");
 for(const dx of [-r.w*.4,0,r.w*.4])addBox(g,.06,.9,.06,dx,.56,r.d*.42,"#647c6c");
}
function tileTexture(second){
 const c=document.createElement("canvas");c.width=256;c.height=256;const ctx=c.getContext("2d");
 const n=4;const size=256/n;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  ctx.fillStyle=second?((x+y)%2===0?"#dedacb":"#b5c6c3"):"#e5dfd1";
  ctx.fillRect(x*size,y*size,size-2,size-2);
  if(!second){for(let k=0;k<85;k++){const ox=x*size+((k*43+19)%size),oy=y*size+((k*71+13)%size);ctx.fillStyle=k%3===0?"#afa798":"#f3eee2";ctx.fillRect(ox,oy,1.5,1.5)}}
 }
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.repeat.set(2.5,2.5);return t;
}
let tilesA,tilesB;
function labelSprite(name){
 const c=document.createElement("canvas");c.width=450;c.height=116;const g=c.getContext("2d");
 g.fillStyle="#17281f";g.beginPath();g.roundRect(3,8,444,96,21);g.fill();
 g.strokeStyle="#d8c4a3";g.lineWidth=2;g.stroke();
 g.font="700 35px DM Sans, Arial";g.textAlign="center";g.textBaseline="middle";g.fillStyle="#f9f5ed";
 g.fillText(name.length>21?name.slice(0,20)+"…":name,225,56);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
 const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true}));
 sp.scale.set(2.35,.61,1);sp.renderOrder=20;return sp;
}
function makeFurniture(group,r,second){
 const x=r.x,z=r.z;
 if(r.kind==="lounge"){
  const sofa=second?"#a9b3a6":"#9c2538";
  addSofa(group,x-.60,z+.50,0,sofa);
  addSofa(group,x+.85,z-.58,Math.PI/2,sofa);
  addBox(group,1.1,.26,.62,x+.25,.27,z+.35,second?"#b7a587":"#9e805c");
  addBox(group,1.5,.03,.85,x+.18,.13,z+.32,"#d8cfc0");
 }else if(r.kind==="bed"){
  addBed(group,x,z,Math.min(1.75,r.w*.52),Math.PI/2);
  addBox(group,.6,.57,.5,x+r.w*.34,.46,z+r.d*.27,"#b5a694");
 }else if(r.kind==="bath")addBath(group,r);
 else if(r.kind==="dining")addTable(group,x,z);
 else if(r.kind==="kitchen")addKitchen(group,r);
 else if(r.kind==="exterior")addExterior(group,r);
 else{
  addBox(group,.74,.72,.36,x-r.w*.12,.45,z,"#847565");
  addBox(group,.11,1.65,.12,x+r.w*.25,.88,z-r.d*.20,"#b6aca0");
 }
}
function addPhotoFrame(group,r,index){
 if(r.kind==="hall"||r.kind==="exterior")return;
 const g=new THREE.Group();g.position.set(r.x+r.w*.29,.25,r.z+r.d*.24);g.rotation.y=-.2;group.add(g);
 const w=.78,h=1.26;
 addBox(g,w+.10,h+.10,.06,0,1.11,0,"#222c24");
 const plane=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:imageTex(r.id),side:THREE.DoubleSide}));
 plane.position.set(0,1.11,.044);g.add(plane);
 plane.userData.roomIndex=index;hitTargets.push(plane);
}
function makeRoom(r,i,second){
 const group=new THREE.Group();world.add(group);
 const floor=new THREE.Mesh(new THREE.BoxGeometry(r.w,.16,r.d),new THREE.MeshStandardMaterial({map:second?tilesB:tilesA,roughness:1}));
 floor.position.set(r.x,.07,r.z);floor.receiveShadow=true;floor.userData.roomIndex=i;group.add(floor);hitTargets.push(floor);roomMeshes[i]=floor;
 const c=r.kind==="bath"?"#d6e7e5":r.kind==="exterior"?"#a6bb9f":"#e6e4d9";
 const wall=mat(c,{transparent:true,opacity:.96,side:THREE.DoubleSide});
 const thickness=.10;const hh=1.45;
 const back=new THREE.Mesh(new THREE.BoxGeometry(r.w,hh,thickness),wall);back.position.set(r.x,hh/2,r.z-r.d/2);back.castShadow=true;back.receiveShadow=true;group.add(back);
 const left=new THREE.Mesh(new THREE.BoxGeometry(thickness,hh,r.d),wall);left.position.set(r.x-r.w/2,hh/2,r.z);left.castShadow=true;left.receiveShadow=true;group.add(left);
 const right=new THREE.Mesh(new THREE.BoxGeometry(thickness,hh,r.d),wall);right.position.set(r.x+r.w/2,hh/2,r.z);right.castShadow=true;right.receiveShadow=true;group.add(right);
 const front=new THREE.Mesh(new THREE.BoxGeometry(r.w,.20,thickness),mat("#e3dfd4"));front.position.set(r.x,.11,r.z+r.d/2);group.add(front);
 if(r.kind==="bath"){
  addBox(group,r.w-.19,.56,.07,r.x,.35,r.z-r.d/2+.08,"#9bc2cc",{transparent:true,opacity:.8});
 }
 if(r.kind!=="exterior"&&r.kind!=="bath"){
  addBox(group,.88,.72,.045,r.x-r.w*.19,.95,r.z-r.d/2+.085,"#7d9da1",{metalness:.15,roughness:.18,emissive:"#1b353f",emissiveIntensity:.22});
  addBox(group,.025,.78,.1,r.x-r.w*.19,1.0,r.z-r.d/2+.08,"#eef0e9");
  addBox(group,.95,.045,.10,r.x-r.w*.19,1.33,r.z-r.d/2+.08,"#e8e3d7");
 }
 makeFurniture(group,r,second);addPhotoFrame(group,r,i);
 const pin=labelSprite(r.name);pin.position.set(r.x,2.52,r.z);pin.userData.roomIndex=i;world.add(pin);hitTargets.push(pin);roomPins[i]=pin;
 const marker=new THREE.Mesh(new THREE.SphereGeometry(.11,12,8),new THREE.MeshStandardMaterial({color:"#efca86",emissive:"#e0b675",emissiveIntensity:.4}));
 marker.position.set(r.x,1.87,r.z);marker.userData.roomIndex=i;world.add(marker);hitTargets.push(marker);
}
function highlightRoom(){
 roomMeshes.forEach((m,i)=>{if(!m)return;m.material.emissive=new THREE.Color(i===selectedRoom?0x33472d:0x000000);m.material.emissiveIntensity=i===selectedRoom?.17:0});
 roomPins.forEach((s,i)=>{if(s){const k=i===selectedRoom?1.08:.9;s.scale.set(2.35*k,.61*k,1)}});
}
function render3DHouse(){
 if(!scene)return;
 if(world){scene.remove(world);world.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&o.material!==tilesA&&o.material!==tilesB){if(Array.isArray(o.material))o.material.forEach(x=>x.dispose());else o.material.dispose()}})}
 world=new THREE.Group();scene.add(world);hitTargets=[];roomMeshes=[];roomPins=[];
 const second=selectedProperty===1;
 prop().rooms.forEach((r,i)=>makeRoom(r,i,second));
 const route=prop().rooms.filter(r=>r.kind!=="exterior").map(r=>new THREE.Vector3(r.x,.24,r.z));
 if(route.length>1){
  const curve=new THREE.CatmullRomCurve3(route);
  const path=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(75)),new THREE.LineDashedMaterial({color:0xb5bfa9,transparent:true,opacity:.65,dashSize:.25,gapSize:.18}));
  path.computeLineDistances();world.add(path);
 }
 highlightRoom();
}
function resize(){
 if(!renderer||!camera)return;
 const el=$("glScene");const w=el.clientWidth||500,h=el.clientHeight||500;
 renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
}
function init3D(){
 try{
 const canvas=$("glCanvas");
 renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:"low-power"});
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.26;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene=new THREE.Scene();
 scene.fog=new THREE.Fog(0x1c3022,30,60);
 camera=new THREE.PerspectiveCamera(38,1,.1,120);camera.position.set(17,19,21);
 controls=new OrbitControls(camera,canvas);controls.target.set(0,.35,1);
 controls.enableDamping=true;controls.dampingFactor=.065;controls.maxPolarAngle=Math.PI*.47;controls.minPolarAngle=.15;controls.minDistance=5.2;controls.maxDistance=48;controls.enablePan=true;controls.screenSpacePanning=true;
 raycaster=new THREE.Raycaster();mouse=new THREE.Vector2();
 const ambient=new THREE.HemisphereLight(0xf2f8f1,0x36462e,2.0);scene.add(ambient);
 const sun=new THREE.DirectionalLight(0xffefcd,3.0);sun.position.set(-12,23,12);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-22;sun.shadow.camera.right=22;sun.shadow.camera.top=22;sun.shadow.camera.bottom=-22;sun.shadow.normalBias=.04;scene.add(sun);
 const fill=new THREE.DirectionalLight(0xbfd8ef,1.2);fill.position.set(10,9,-12);scene.add(fill);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(150,150),new THREE.MeshStandardMaterial({color:"#21332a",roughness:1,transparent:true,opacity:.60}));
 ground.rotation.x=-Math.PI/2;ground.position.y=-.15;ground.receiveShadow=true;scene.add(ground);
 const shade=new THREE.Mesh(new THREE.CircleGeometry(12,64),new THREE.MeshBasicMaterial({color:"#0a130e",transparent:true,opacity:.19,depthWrite:false}));
 shade.rotation.x=-Math.PI/2;shade.position.y=-.135;shade.scale.set(1.2,.72,1);scene.add(shade);
 tilesA=tileTexture(false);tilesB=tileTexture(true);
 const pointer={x:0,y:0,down:false,moved:false};
 canvas.addEventListener("pointerdown",e=>{pointer.x=e.clientX;pointer.y=e.clientY;pointer.down=true;pointer.moved=false;flight=null;flyToken++});
 canvas.addEventListener("pointermove",e=>{if(pointer.down&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>7)pointer.moved=true;});
 canvas.addEventListener("pointerup",e=>{
  if(!pointer.down)return;pointer.down=false;if(pointer.moved||mode!=="3d")return;
  const rect=canvas.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,-((e.clientY-rect.top)/rect.height*2-1));
  raycaster.setFromCamera(mouse,camera);const hits=raycaster.intersectObjects(hitTargets,false);
  if(hits.length){const i=hits[0].object.userData.roomIndex;if(typeof i==="number")pickRoom(i,true)}
 });
 canvas.addEventListener("pointerleave",()=>{pointer.down=false});
 window.addEventListener("resize",resize);
 if("ResizeObserver" in window)new ResizeObserver(()=>resize()).observe($("viewer"));
 render3DHouse();resize();
 const tick=()=>{
  requestAnimationFrame(tick);
  if(flight){
   const v=Math.min(1,(performance.now()-flight.at)/flight.duration),k=ease(v);
   camera.position.lerpVectors(flight.fromPos,flight.toPos,k);
   controls.target.lerpVectors(flight.fromTarget,flight.toTarget,k);
   if(v>=1){const done=flight.done;flight=null;done?.()}
  }
  controls.update();
  if(mode==="3d")renderer.render(scene,camera);
 };
 tick();ready=true;
 }catch(err){
  console.error("Vyral 3D initialization failed",err);
  toast("3D not available here — the floor plan and photo tour still work");
  ready=false;setMode("plan");
 }
 $("loadingCurtain").classList.add("finished");
}
function resetCamera(){
 if(!camera||!controls)return;
 flight={at:performance.now(),duration:1000,fromPos:camera.position.clone(),toPos:new THREE.Vector3(17,19,21),fromTarget:controls.target.clone(),toTarget:new THREE.Vector3(0,.4,1),done:null};
}
function flyCamera(roomIndex,enter=false,duration=1100){
 if(!camera||!controls){if(enter)setMode("photo");return Promise.resolve()}
 const r=prop().rooms[roomIndex];
 return new Promise(resolve=>{
   flight={
     at:performance.now(),duration,
     fromPos:camera.position.clone(),toPos:new THREE.Vector3(r.x+2.35,7.6,r.z+3.5),
     fromTarget:controls.target.clone(),toTarget:new THREE.Vector3(r.x,.2,r.z),
     done:()=>{if(enter)setMode("photo");resolve()}
   };
 });
}
function flyToIndex(i,enter=true){return flyCamera(i,enter)}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function flyover(){
 const token=++flyToken;
 $("flyButton").querySelector("span").textContent="Stop flyover";
 setMode("3d");
 const seq=prop().rooms.map((r,i)=>i);
 for(const idx of seq){
  if(token!==flyToken)break;
  selectRoom(idx);
  await flyCamera(idx,false,1150);
  if(token!==flyToken)break;
  await delay(480);
 }
 if(token===flyToken)resetCamera();
 $("flyButton").querySelector("span").textContent="Guided flyover";
}
function toggleFlyover(){
 if($("flyButton").querySelector("span").textContent==="Stop flyover"){
  ++flyToken;flight=null;resetCamera();$("flyButton").querySelector("span").textContent="Guided flyover";
 }else flyover().catch(console.error);
}
function onPhotoDrag(){
 const el=$("photoCrop"),img=$("roomPhoto");let x=0,start=0,down=false;
 el.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"&&e.button!==0)return;down=true;start=e.clientX;x=dragAmount;el.classList.add("dragging");el.setPointerCapture(e.pointerId)});
 el.addEventListener("pointermove",e=>{if(!down)return;dragAmount=Math.max(-85,Math.min(85,x+(e.clientX-start)*.35));img.style.transform="translateX("+dragAmount+"px) scale(1.08)"});
 const end=()=>{down=false;el.classList.remove("dragging")};el.addEventListener("pointerup",end);el.addEventListener("pointercancel",end);
}
function showVideo(){
 const el=$("sourceVideo");$("videoModal").classList.remove("isHidden");
 el.src=prop().video;el.load();el.currentTime=room().t;el.play().catch(()=>{});
}
function hideVideo(){const el=$("sourceVideo");el.pause();el.removeAttribute("src");el.load();$("videoModal").classList.add("isHidden")}
function share(){
 const url=location.origin+location.pathname+"#tour-"+(selectedProperty+1);
 if(navigator.share)navigator.share({title:"Vyral Spaces",url}).catch(()=>{});
 else if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(()=>toast("Tour link copied")).catch(()=>toast("Copy the address bar to share"));
 else toast("Copy the address bar to share");
}
function initialize(){
 const query=location.hash.includes("tour-2")||location.hash.includes("tour-02");if(query){selectedProperty=1;selectedRoom=prop().start}
 renderPanel();renderPlan();renderPhoto();
 document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{++flyToken;setMode(b.dataset.mode)});
 $("chooseProperty").onclick=openPicker;$("closeModal").onclick=()=>$("propertyModal").classList.add("isHidden");
 $("propertyModal").addEventListener("click",e=>{if(e.target===$("propertyModal"))$("propertyModal").classList.add("isHidden")});
 $("shareButton").onclick=share;$("resetCamera").onclick=resetCamera;
 $("fullscreen").onclick=()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else $("viewer").requestFullscreen?.().catch(()=>toast("Fullscreen not supported"))};
 $("photoPrev").onclick=()=>pickRoom(selectedRoom-1,true);
 $("photoNext").onclick=()=>pickRoom(selectedRoom+1,true);
 $("flyButton").onclick=toggleFlyover;
 $("videoButton").onclick=showVideo;$("closeVideo").onclick=hideVideo;
 $("videoModal").addEventListener("click",e=>{if(e.target===$("videoModal"))hideVideo()});
 $("panelHelp").onclick=()=>toast("3D is an illustrative cutaway. Photos and partial sweeps come from the actual videos.");
 document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){$("propertyModal").classList.add("isHidden");hideVideo()}
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA")return;
  if(e.key==="ArrowRight")pickRoom(selectedRoom+1,mode==="photo");
  if(e.key==="ArrowLeft")pickRoom(selectedRoom-1,mode==="photo");
  if(e.key==="1")setMode("3d");
  if(e.key==="2")setMode("photo");
  if(e.key==="3")setMode("plan");
 });
 onPhotoDrag();setMode("3d");init3D();
}
initialize();