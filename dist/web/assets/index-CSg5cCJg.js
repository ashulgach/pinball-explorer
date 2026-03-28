(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))s(i);new MutationObserver(i=>{for(const c of i)if(c.type==="childList")for(const o of c.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&s(o)}).observe(document,{childList:!0,subtree:!0});function a(i){const c={};return i.integrity&&(c.integrity=i.integrity),i.referrerPolicy&&(c.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?c.credentials="include":i.crossOrigin==="anonymous"?c.credentials="omit":c.credentials="same-origin",c}function s(i){if(i.ep)return;i.ep=!0;const c=a(i);fetch(i.href,c)}})();const mn=typeof window<"u"&&!window.electronAPI&&!window.__pinballServerMode,vt=new Map;function gn(){for(const e of vt.values())URL.revokeObjectURL(e);vt.clear()}let be=null;function Ve(e){be&&(e.name!==be.name||e.size!==be.size)&&gn(),be=e}function hn(){return be}if(mn){let s=function(){return e||(e=new Worker(new URL("/assets/worker-BQgqril7.js",import.meta.url),{type:"module"}),e.onmessage=l=>{const{id:u,result:p,error:f}=l.data,v=a.get(u);v&&(a.delete(u),f?v.reject(new Error(f)):v.resolve(p))},e.onerror=l=>console.error("[web-mode] Worker error:",l)),e},i=function(l,u={}){return new Promise((p,f)=>{const v=++t;a.set(v,{resolve:p,reject:f}),s().postMessage({id:v,command:l,...u})})},o=function(l){return new Response(JSON.stringify(l),{status:200,headers:{"Content-Type":"application/json"}})},d=function(l,u){return new Response(JSON.stringify({error:u}),{status:l,headers:{"Content-Type":"application/json"}})};console.log("[web-mode] Initializing browser-only mode"),window.__pinballWebFileInput=!0,window.__pinballWebSetFile=l=>Ve(l);let e=null,t=0;const a=new Map;window.addEventListener("DOMContentLoaded",()=>{const l=document.getElementById("webFileInput"),u=document.getElementById("loadBtn"),p=document.querySelector(".load-overlay-action");l&&(u&&u.addEventListener("click",f=>{f.preventDefault(),f.stopPropagation(),l.click()}),p&&p.addEventListener("click",f=>{f.preventDefault(),f.stopPropagation(),l.click()}),l.addEventListener("change",async()=>{const f=l.files?.[0];if(!f)return;Ve(f);const v=document.getElementById("targetInput");v&&(v.value=f.name),window.dispatchEvent(new CustomEvent("pinball-web-file-loaded",{detail:{file:f}}))})),document.body.addEventListener("drop",f=>{const v=f.dataTransfer?.files?.[0];if(v&&(v.name.endsWith(".raw")||v.name.endsWith(".img")||v.name.endsWith(".iso"))){f.preventDefault(),f.stopPropagation(),document.body.classList.remove("drag-over"),Ve(v);const w=document.getElementById("targetInput");w&&(w.value=v.name),window.dispatchEvent(new CustomEvent("pinball-web-file-loaded",{detail:{file:v}}))}},!0)});const c=window.fetch;window.fetch=async function(l,u){if(typeof l!="string"||!l.startsWith("/api/"))return c.call(this,l,u);const p=new URL(l,window.location.origin),f=p.pathname,v=p.searchParams,w=hn();try{switch(f){case"/api/default-target":return o({defaultTarget:""});case"/api/pick-file":{const g=document.getElementById("webFileInput");return g&&g.click(),o({path:""})}case"/api/inspect":{if(!w)return d(400,"No file loaded");const g=await i("inspect",{file:w});return o(g)}case"/api/asset":case"/api/asset-preview":{if(!w)return d(400,"No file loaded");const g=v.get("asset"),b=u?.headers?.Range||u?.headers?.range;let P=0,B=null;if(b){const I=b.match(/bytes=(\d+)-(\d*)/);I&&(P=parseInt(I[1]),B=I[2]?parseInt(I[2]):null)}const R=await i("readAsset",{file:w,assetPath:g,start:P,end:B}),C=new Blob([R.buffer],{type:R.contentType});return new Response(C,{status:200,headers:{"Content-Type":R.contentType}})}case"/api/scene-metadata":{if(!w)return d(400,"No file loaded");const g=v.get("scene"),b=await i("describeScene",{file:w,scenePath:g});return o(b)}case"/api/scene-frame-preview":{if(!w)return d(400,"No file loaded");const g=v.get("scene"),b=v.get("asset"),P=await i("sceneFramePreview",{file:w,scenePath:g,assetPath:b}),B=new Blob([P.buffer],{type:P.contentType});return new Response(B,{status:200,headers:{"Content-Type":P.contentType}})}case"/api/radium-scene":{if(!w)return d(400,"No file loaded");const g=v.get("scene"),b=await i("parseRadiumScene",{file:w,scenePath:g});return o(b)}case"/api/radium-image":{if(!w)return d(400,"No file loaded");const g=v.get("scene"),b=v.get("image")||v.get("id"),P=await i("renderRadiumImage",{file:w,scenePath:g,imageId:b}),B=new Blob([P.buffer],{type:P.contentType});return new Response(B,{status:200,headers:{"Content-Type":P.contentType}})}case"/api/rule-graph":return d(501,"Rule graph not yet supported in web mode");case"/api/sound-preview":case"/api/sound-export":return d(501,"Sound preview not yet supported in web mode");case"/api/sound-replace":case"/api/video-replace":case"/api/radium-image-replace":return d(501,"Write operations not yet supported in web mode");case"/api/asset-metadata":{if(u?.method==="POST"){const b=await new Response(u.body).json();return localStorage.setItem("pinball-asset-metadata",JSON.stringify(b)),o({ok:!0})}const g=localStorage.getItem("pinball-asset-metadata");return o(g?JSON.parse(g):{})}default:return console.warn(`[web-mode] Unhandled API call: ${f}`),d(404,`Not found: ${f}`)}}catch(g){return console.error(`[web-mode] Error handling ${f}:`,g),d(500,g.message)}},window.__pinballWebInspectFile=null,window.addEventListener("pinball-web-file-loaded",async l=>{const u=l.detail.file;if(!u)return;const p=document.getElementById("targetInput");p&&(p.value=u.name,p.dispatchEvent(new Event("change")))})}const E=document.getElementById("targetPath"),te=document.getElementById("assetSearch"),yt=document.querySelector('label[for="assetSearch"]'),Be=document.getElementById("viewableOnly"),wt=Be?.closest(".control-row"),bt=document.querySelector('label[for="sceneTypeFilter"]'),_=document.getElementById("sceneTypeFilter"),ye=document.getElementById("targetSummary"),N=document.getElementById("assetList"),Z=document.getElementById("assetListHeading"),St=document.getElementById("loadOverlay"),vn=document.getElementById("loadOverlayButton"),Ge=document.getElementById("topbarFileLabel"),yn=document.getElementById("topbarLoadNew"),x=document.getElementById("sidebarResizer"),j=document.getElementById("viewer"),W=document.getElementById("viewerSelectionName"),we=document.getElementById("selectionInspector"),$t=document.getElementById("packageInspector"),Pt=document.getElementById("manifestInspector"),It=document.getElementById("sidebarFilters"),wn=document.getElementById("statusbar"),bn=document.getElementById("tabCountFonts"),Sn=document.getElementById("tabCountImages"),$n=document.getElementById("tabCountScenes"),Pn=document.getElementById("tabCountAudio"),Et=document.getElementById("tabCountVideos"),Bt=document.getElementById("tabCountGraph"),n={currentData:null,selectedAssetPath:null,selectedSoundScriptIndex:null,playingSoundScriptIndex:null,activeView:"assets",activeKind:"all",loading:!1,error:"",ruleGraph:null,ruleGraphLoading:!1,ruleGraphError:"",selectedGraphNodeId:null,expandedGraphFamilies:{},graphSceneNameByPath:{},sceneDetailsByPath:{},sceneLoadingByPath:{},previewLoadingByKey:{},previewLoadedByKey:{},soundPreviewLoadingByScript:{},soundPreviewPreparedByScript:{},soundPreviewRevisionByScript:{},soundActionPending:!1,soundActionError:"",assetMetadataDraftByPath:{},assetMetadataPendingPath:null,assetMetadataSavedPath:null,assetMetadataErrorPath:null,assetMetadataError:"",inlineAssetEditorPath:null,sidebarInlineAssetEditorPath:null,radiumScenesByPath:{},radiumSceneLoadingByPath:{},expandedScenePaths:{},selectedSceneNodeId:null,selectedSceneNodeScenePath:null,sceneNodeAliasByKey:{},imageReplacePending:!1,imageReplaceError:"",imageReplaceSuccess:null,videoReplacePending:!1,videoReplaceError:"",videoReplaceAssetPath:null},Rt="pinball-explorer.sidebar-width",oe=220,ce=420,ne="radium-node::",_e="sound-script::",In=5,A={activeAnimationTimer:null,previewTransitionTimer:null,renderAllTimer:null,renderAudioSelectionTimer:null},$={soundRowPlayer:new Audio,soundRowPlayerScriptIndex:null,activeRadiumPlayer:null};$.soundRowPlayer.preload="none";let $e=0;function En(){return $e+=1,$e}let G=0;function Bn(){return G+=1,G}const Q=new Map;let Qe=()=>{},Ct=()=>!1;function Ln(e){Qe=e}function kn(e){Ct=e}function k(){A.renderAllTimer===null&&(A.renderAllTimer=window.setTimeout(()=>{A.renderAllTimer=null,Qe()},0))}function qe(){A.renderAudioSelectionTimer===null&&(A.renderAudioSelectionTimer=window.setTimeout(()=>{A.renderAudioSelectionTimer=null,Ct()||Qe()},0))}function Y(e,t,a){return Math.min(a,Math.max(t,e))}function An(){const e=window.localStorage.getItem(Rt),t=Number(e);return Number.isFinite(t)?Y(t,oe,ce):240}function Oe(e){const t=Y(e,oe,ce);return document.documentElement.style.setProperty("--sidebar-width",`${t}px`),x?.setAttribute("aria-valuenow",String(t)),x?.setAttribute("aria-valuemin",String(oe)),x?.setAttribute("aria-valuemax",String(ce)),t}function Lt(e){window.localStorage.setItem(Rt,String(e))}function r(e){return String(e??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function y(e){return e==null?"n/a":new Intl.NumberFormat().format(e)}function ze(e){return e==null?"n/a":`0x${e.toString(16)}`}function T(e){const t=String(e||"").split("/");return t[t.length-1]||e}function Nt(e){return e&&typeof e=="object"?e.path||e.assetPath||"":String(e||"")}function Ue(e,t,a=""){const s=String(t||"").trim();if(!s)return"";const i=String(a||T(e));return s===i?"":s}function xt(e){const t=String(e||"");if(!t)return"unknown";const a=t.split(".");return a[a.length-1]||t}function D(e){return e.length?`<dl class="kv">${e.map(([t,a])=>`
    <dt>${r(t)}</dt>
    <dd>${a}</dd>
  `).join("")}</dl>`:'<p class="muted">No metadata available.</p>'}function We(e,t="string-list"){return e?.length?`<ul class="${t}">${e.map(a=>`<li><code>${r(a)}</code></li>`).join("")}</ul>`:'<p class="muted">None</p>'}function J(e){return e==="spinner"?'<span class="row-action-spinner" aria-hidden="true"></span>':e==="play"?`
      <svg class="row-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M5 3.5v9l7-4.5z" fill="currentColor"></path>
      </svg>
    `:`
    <svg class="row-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="8" height="8" fill="currentColor"></rect>
    </svg>
  `}function Pe(e){const t=Number(e);return!Number.isFinite(t)||t<0?"n/a":t<1e3?`${t} ms`:`${(t/1e3).toFixed(3)} s`}function et(e){return e?e.channelCount===2?"Stereo":e.channelCount===1?"Mono":e.channelCount>2?`${e.channelCount} channels`:"Silent":"n/a"}function tt(e,t){return`${ne}${e}::${t}`}function K(){return n.currentData?.spike?.assetFiles||[]}function Mt(e){if(e&&typeof e=="object"&&(e.alias!==void 0||e.description!==void 0))return e;const t=Nt(e);return t&&K().find(a=>a.path===t)||(e&&typeof e=="object"?e:null)}function nt(e){return String(Mt(e)?.alias||"").trim()}function xe(e){return String(Mt(e)?.description||"").trim()}function L(e){const t=nt(e);if(t)return t;const a=Nt(e),s=n.graphSceneNameByPath[a];return s||T(a)}function Tt(e){return Vt(e?.path,e)}function Rn(e){return[e.path,e.scenePath,e.sceneLabel,e.kind,e.format,L(e),nt(e),xe(e)].filter(Boolean).join(`
`).toLowerCase()}function at(){return n.currentData?.spike?.soundSystem||null}function Le(){return n.currentData?.spike?.soundScripts||[]}function Me(e){return Le().find(t=>t.scriptIndex===e)||null}function ae(){return Me(n.selectedSoundScriptIndex)}function Dt(e){const t=Number(typeof e=="object"?e?.scriptIndex:e);return!Number.isInteger(t)||t<0?"":`${_e}${t}`}function Ft(e){const t=String(e||"");if(!t.startsWith(_e))return null;const a=Number(t.slice(_e.length));return!Number.isInteger(a)||a<0?null:a}function Te(e){const t=Ft(e);return t===null?null:Me(t)}function Kt(e){return String(e?.alias||"").trim()}function st(e){const t=String(e?.defaultLabel||e?.label||"").trim();if(t)return t;const a=Number(e?.scriptIndex);return Number.isInteger(a)?`Script ${a}`:"Untitled sound"}function H(e){return Kt(e)||st(e)}function se(e){const t=st(e);return t===H(e)?"":t}function ke(e){const t=K().find(s=>s.path===e);if(t)return nt(t);const a=Te(e);return a?Kt(a):String(e||"").startsWith(ne)&&n.sceneNodeAliasByKey[e]||""}function de(e){const t=K().find(s=>s.path===e);if(t)return T(t.path);const a=Te(e);return a?st(a):String(e||"").startsWith(ne)?e.split("::").pop()||e:T(e)}function Ht(e){const t=K().find(i=>i.path===e);if(t)return L(t);const a=Te(e);if(a)return H(a);const s=n.sceneNodeAliasByKey[e];return s||de(e)}function q(e){const t=K().find(s=>s.path===e);if(t)return xe(t);const a=Te(e);return a?String(a.description||"").trim():""}function Vt(e,t=null){if(!e)return{alias:"",description:""};const a=n.assetMetadataDraftByPath[e],s=t?String(t.alias||""):ke(e),i=t?String(t.description||""):q(e);return{alias:a?.alias??s,description:a?.description??i}}function F(){return n.activeView==="assets"&&n.activeKind==="audio"}function me(){return n.activeView==="graph"}function U(){return K().find(e=>e.path===n.selectedAssetPath)||null}function ue(e){return e?e.kind==="scene"||e.format==="radium"?e.path:e.scenePath||null:null}function ie(e){const t=ue(e);return t&&n.sceneDetailsByPath[t]||null}function Gt(e,t="Unknown"){return n.sceneDetailsByPath[e]?.sceneType||t}function Ut(e){const t=ue(e);return Gt(t,e?.sceneType||"Unknown")}function M(e){return!!(e&&(e.kind==="scene"||e.format==="radium"))}function it(e,t){return!e?.frames?.length||!t?.path?null:e.frames.find(a=>a.assetPath===t.path)||null}function rt(e){return e?.previewable||e?.previewKind||e?.previewMode?!0:!!ie(e)?.previewKind}function X(e){return`/api/asset?path=${encodeURIComponent(E.value.trim())}&asset=${encodeURIComponent(e)}`}function Ie(e,t){return`/api/scene-frame-preview?path=${encodeURIComponent(E.value.trim())}&scene=${encodeURIComponent(e)}&asset=${encodeURIComponent(t)}`}function ot(e){if(!e)return"";if(e?.previewMode==="radium-gray8")return`/api/asset-preview?path=${encodeURIComponent(E.value.trim())}&asset=${encodeURIComponent(e.path)}`;const t=ie(e);if(!M(e)){const a=it(t,e);return a?Ie(t.scenePath,a.assetPath):X(e.path)}return t?.previewKind==="video"&&t.previewAssetPath?X(t.previewAssetPath):t?.previewKind==="flipbook"&&t.frames?.length?Ie(t.scenePath,t.frames[0].assetPath):X(e.path)}function De(){const e=te.value.trim().toLowerCase(),t=_.value;return K().filter(a=>!(n.activeKind!=="all"&&a.kind!==n.activeKind||e&&!Rn(a).includes(e)||Be.checked&&!rt(a)||t&&Ut(a)!==t))}function Wt(){const e=te.value.trim().toLowerCase();return Le().filter(t=>Be.checked&&t.byteLength<=0?!1:e?[H(t),se(t),`0x${t.scriptIndex.toString(16)}`,t.codec,t.durationMs,t.fragmentCount,t.stereo?"stereo":"mono",t.channelCount].join(" ").toLowerCase().includes(e):!0)}function Cn(){return De().filter(e=>M(e))}function Nn(){return n.activeView==="scenes"&&_.value==="Video"}function xn(){const e=new Map(K().filter(s=>M(s)).map(s=>[s.path,s])),t=new Map,a=s=>{if(!s)return null;let i=t.get(s);if(!i){const c=e.get(s)||null;i={scenePath:s,sceneType:Gt(s,c?.sceneType||"RawScene"),sceneAsset:c,assets:[],clipLabels:new Set},t.set(s,i)}return i};for(const s of Cn())a(s.path);for(const s of De()){if(!s.scenePath||s.path===s.scenePath||!rt(s))continue;const i=a(s.scenePath);i&&(i.assets.push(s),s.sceneLabel&&i.clipLabels.add(s.sceneLabel))}return[...t.values()].map(s=>({...s,clipLabels:[...s.clipLabels].sort()})).sort((s,i)=>s.scenePath.localeCompare(i.scenePath))}function Mn(){return xn()}function Tn(){return[...new Set(K().map(e=>Ut(e)).filter(Boolean))].sort()}function O(){const e=Fn();if(!e.length){n.selectedAssetPath=null;return}(!n.selectedAssetPath||!e.some(t=>t.path===n.selectedAssetPath))&&(n.selectedAssetPath=e[0].path)}function jt(){const e=Wt();if(!e.length){n.selectedSoundScriptIndex=null;return}(n.selectedSoundScriptIndex===null||!e.some(t=>t.scriptIndex===n.selectedSoundScriptIndex))&&(n.selectedSoundScriptIndex=e[0].scriptIndex)}function Dn(e){return e.assets.find(t=>t.clipFrames?.length)||e.assets.find(t=>t.previewKind==="image")||e.assets[0]||null}function ct(){const e=Mn();if(Nn()){const t=e.flatMap(a=>a.sceneType!=="Video"?[]:a.assets.filter(s=>s.path!==a.scenePath&&s.previewKind==="video").map(s=>({rowType:"asset",scene:a,asset:s})));if(t.length)return t.sort((a,s)=>a.asset.path.localeCompare(s.asset.path))}return e.map(t=>({rowType:"scene",scene:t,asset:t.sceneAsset||Dn(t)})).filter(t=>t.asset)}function Fn(){return n.activeView==="scenes"?ct().map(e=>e.asset).filter(Boolean):De()}function Kn(e=ct()){return e.some(t=>t.rowType==="asset")}function dt(e,t){return n.sceneNodeAliasByKey[tt(e,t)]||""}async function Hn(){try{const t=await(await fetch("/api/asset-metadata")).json();if(t?.assets)for(const[a,s]of Object.entries(t.assets))a.startsWith(ne)&&s?.alias&&(n.sceneNodeAliasByKey[a]=s.alias)}catch{}}function Vn(e,t={}){const a=String(t.alias||""),s=String(t.description||""),i=Ft(e);n.currentData?.spike&&(n.currentData={...n.currentData,spike:{...n.currentData.spike,assetFiles:(n.currentData.spike.assetFiles||[]).map(c=>c.path===e?{...c,alias:a,description:s}:c),soundScripts:(n.currentData.spike.soundScripts||[]).map(c=>c.scriptIndex===i?{...c,alias:a,description:s}:c)}})}function Gn(){Q.clear(),n.previewLoadingByKey={},n.previewLoadedByKey={},n.soundPreviewLoadingByScript={},n.soundPreviewPreparedByScript={},n.soundPreviewRevisionByScript={}}function Ee(e,t,a=""){const s=Vt(e),i=n.assetMetadataPendingPath===e,c=s.alias||Ht(e)||t;return`
    <div class="rail-inline-edit-row">
      <form class="rail-inline-edit-form" data-sidebar-inline-asset-title-form data-sidebar-inline-asset-path="${r(e)}">
        <input
          class="rail-inline-edit-input"
          type="text"
          spellcheck="false"
          value="${r(c)}"
          data-sidebar-inline-asset-alias-input
          ${i?"disabled":""}
        >
        <button
          class="asset-edit-button asset-edit-button-compact"
          type="submit"
          aria-label="Save asset name"
          title="Save asset name"
          ${i?"disabled":""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M6.6 11.2 3.4 8l-1.1 1.1 4.3 4.3 7.1-7.1-1.1-1.1z" fill="currentColor"></path>
          </svg>
        </button>
        <button
          class="asset-edit-button asset-edit-button-compact"
          type="button"
          data-cancel-sidebar-inline-asset-edit="${r(e)}"
          aria-label="Cancel asset name edit"
          title="Cancel"
          ${i?"disabled":""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m4.1 3 3.9 3.9L11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1z" fill="currentColor"></path>
          </svg>
        </button>
      </form>
      ${a}
    </div>
  `}function Un(e,t){const a=String(e||"");if(!a)return"";const s=String(t||"").replace(/\/scene\.radium$/,"");if(s&&a.startsWith(`${s}/`)){const c=a.slice(s.length+1),o=c.split("/").filter(Boolean);return o.length<=4?c:`.../${o.slice(-4).join("/")}`}const i=a.split("/").filter(Boolean);return i.length<=4?a:`.../${i.slice(-4).join("/")}`}function Xe(e){return String(e||"").toLowerCase().replaceAll(/[^a-z0-9]+/g,"")}function ge(){return n.ruleGraph?.graph||null}function Ae(){return ge()?.nodes||[]}function Wn(){return ge()?.edges||[]}function he(e=n.selectedGraphNodeId){return Ae().find(t=>t.id===e)||null}function kt(e){return e?.familyKey||Xe(e?.label||"")}function jn(e){return!e||e.type!=="scene"?null:e.scenePath||null}function V(e,t,a="outgoing"){return e?Wn().filter(i=>i.type!==t?!1:a==="incoming"?i.target===e.id:i.source===e.id).map(i=>he(a==="incoming"?i.source:i.target)).filter(Boolean):[]}function _n(e=he()){if(!e)return{node:null,moduleNode:null,familyNode:null,sceneNodes:[]};if(e.type==="rule_module"){const t=V(e,"contains")[0]||null;return{node:e,moduleNode:e,familyNode:t,sceneNodes:t?V(t,"triggers_scene"):[]}}if(e.type==="event_family")return{node:e,moduleNode:V(e,"contains","incoming")[0]||null,familyNode:e,sceneNodes:V(e,"triggers_scene")};if(e.type==="scene"){const t=V(e,"triggers_scene","incoming")[0]||null;return{node:e,moduleNode:t&&V(t,"contains","incoming")[0]||null,familyNode:t,sceneNodes:t?V(t,"triggers_scene"):[e]}}return{node:e,moduleNode:null,familyNode:null,sceneNodes:[]}}function qn(e=he()){const t=kt(e)||kt(_n(e).familyNode);return t?Le().filter(a=>[Xe(H(a)),Xe(se(a))].filter(Boolean).some(i=>i.includes(t)||t.includes(i))):[]}function On(){const e=te.value.trim().toLowerCase(),t=Ae();return e?t.filter(a=>[a.id,a.type,a.label,a.sceneName,a.assetRef,a.scenePath,a.moduleName,a.familyName,a.loadDomain].filter(Boolean).join(`
`).toLowerCase().includes(e)):t}function lt(e){const t=ge();if(!t?.nodes?.length){n.selectedGraphNodeId=null;return}if(n.selectedGraphNodeId&&t.nodes.some(i=>i.id===n.selectedGraphNodeId))return;const a=On(),s=a.find(i=>i.type==="rule_module")||a.find(i=>i.type==="event_family")||a[0]||t.nodes[0];n.selectedGraphNodeId=s?.id||null}function zn(e){return V(e,"triggers_audio")}function Xn(){return Ae().some(e=>e.type==="sound")}function Yn(){const e=Ae().filter(a=>a.type==="event_family"),t=Xn();return e.map(a=>({familyNode:a,sceneNodes:V(a,"triggers_scene"),moduleNodes:V(a,"contains","incoming"),soundNodes:t?zn(a):[],audioCandidates:t?[]:qn(a)})).sort((a,s)=>(a.familyNode.label||"").localeCompare(s.familyNode.label||""))}function _t(){const e=te.value.trim().toLowerCase(),t=Yn();return e?t.filter(a=>[a.familyNode.label,a.familyNode.familyName,...a.sceneNodes.map(i=>i.sceneName||i.label),...a.soundNodes.map(i=>i.label),...a.audioCandidates.map(i=>H(i)),...a.audioCandidates.map(i=>se(i)),...a.moduleNodes.map(i=>i.label||i.moduleName)].filter(Boolean).join(`
`).toLowerCase().includes(e)):t}function Jn(){const e={};for(const t of Ae())t.type==="scene"&&t.scenePath&&t.sceneName&&(e[t.scenePath]=t.sceneName);n.graphSceneNameByPath=e}async function qt({refresh:e=!1}={}){if(!n.currentData||n.ruleGraphLoading&&!e||n.ruleGraph&&!e)return;const t=G;n.ruleGraphLoading=!0,n.ruleGraphError="",k();try{const a=await fetch(`/api/rule-graph?path=${encodeURIComponent(E.value.trim())}`),s=await a.json();if(!a.ok)throw new Error(s.error||"Rule graph extraction failed");if(t!==G)return;n.ruleGraph=s,Jn(),lt()}catch(a){if(t!==G)return;n.ruleGraph=null,n.selectedGraphNodeId=null,n.graphSceneNameByPath={},n.ruleGraphError=a.message}finally{if(t!==G)return;n.ruleGraphLoading=!1,k()}}function Zn(){const e=_t();if(Z&&(Z.textContent="Event families"),n.ruleGraphLoading){N.innerHTML='<p class="muted">Building rule graph from the raw image...</p>';return}if(n.ruleGraphError){N.innerHTML=`<div class="error-state"><strong>Rule graph failed</strong><p>${r(n.ruleGraphError)}</p></div>`;return}if(!e.length){N.innerHTML='<p class="muted">No event families matched the current search.</p>';return}N.innerHTML=e.map(t=>{const a=t.familyNode.label||t.familyNode.id,s=t.soundNodes.length||t.audioCandidates.length,i=t.sceneNodes.length?`${t.sceneNodes.length}s`:"",c=s?`${s}a`:"";return`
      <button class="asset-row" type="button" data-graph-scroll-to-family="${r(t.familyNode.id)}">
        <div class="asset-row-top">
          <span class="asset-title">${r(a)}</span>
          <span class="badge kind-badge">${r([i,c].filter(Boolean).join(" "))}</span>
        </div>
      </button>
    `}).join("")}function Qn(){if(n.ruleGraphLoading)return'<div class="empty-state"><p class="muted">Extracting the rule graph from the mounted raw image...</p></div>';if(n.ruleGraphError)return`<div class="error-state"><strong>Rule graph failed</strong><p>${r(n.ruleGraphError)}</p></div>`;const e=ge();if(!e)return'<div class="empty-state"><p class="muted">Open the Rule Graph tab to build the structured rule export.</p></div>';const t=_t(),a=e.counts||{},s=a.eventFamilies||0,i=a.scenes||0,c=a.ruleModules||0,o=a.sounds||0,d=a.orphanScenes||0,l=`
    <div class="graph-summary-stats">
      <span class="graph-stat-pill">${y(s)} families</span>
      <span class="graph-stat-pill">${y(i)} scenes${d?` (${y(a.namedScenes||0)} named)`:""}</span>
      <span class="graph-stat-pill">${y(o)} sounds</span>
      <span class="graph-stat-pill">${y(c)} rule modules</span>
      <a class="graph-stat-pill graph-stat-link" href="/api/rule-graph?path=${encodeURIComponent(E.value.trim())}" target="_blank" rel="noreferrer">Open JSON</a>
    </div>
  `,u=t.map(p=>{const f=p.familyNode.id,v=p.familyNode.label||f,w=!!n.expandedGraphFamilies[f],g=w?"▼":"▶",b=p.soundNodes.length||p.audioCandidates.length,P=`${p.sceneNodes.length} scene${p.sceneNodes.length!==1?"s":""}`,B=`${b} sound${b!==1?"s":""}`,R=`${p.moduleNodes.length} module${p.moduleNodes.length!==1?"s":""}`;let C="";if(w){const I=p.sceneNodes.length?`
        <div class="graph-family-section">
          <h4>Scenes</h4>
          ${p.sceneNodes.map(h=>`
            <button class="graph-family-row" type="button" data-graph-open-scene="${r(h.id)}">
              <span class="asset-title">${r(h.sceneName||h.label)}</span>
              <span class="badge kind-badge">${r(h.loadDomain||"scene")}</span>
              ${h.inferred?'<span class="badge kind-badge">inferred</span>':""}
            </button>
          `).join("")}
        </div>
      `:"";let z="";p.soundNodes.length?z=`
          <div class="graph-family-section">
            <h4>Sounds</h4>
            ${p.soundNodes.map(h=>`
              <button class="graph-family-row" type="button" data-graph-open-audio="${r(h.scriptIndex)}">
                <span class="asset-title">${r(h.label)}</span>
                <span class="badge kind-badge">${r([`#${h.scriptIndex}`,Pe(h.durationMs),h.codec?`codec ${h.codec}`:""].filter(Boolean).join(" | "))}</span>
              </button>
            `).join("")}
          </div>
        `:p.audioCandidates.length&&(z=`
          <div class="graph-family-section">
            <h4>Sounds</h4>
            ${p.audioCandidates.map(h=>`
              <button class="graph-family-row" type="button" data-graph-open-audio="${r(h.scriptIndex)}">
                <span class="asset-title">${r(H(h))}</span>
                <span class="badge kind-badge">${r([se(h),Pe(h.durationMs),`codec ${h.codec}`].filter(Boolean).join(" | "))}</span>
              </button>
            `).join("")}
          </div>
        `);const re=p.moduleNodes.length?`
        <div class="graph-family-section">
          <h4>Rule modules</h4>
          <div class="graph-module-tags">
            ${p.moduleNodes.map(h=>`<span class="graph-module-tag">${r(h.label||h.moduleName||h.id)}</span>`).join("")}
          </div>
        </div>
      `:"";C=`
        <div class="graph-family-body">
          ${I}
          ${z}
          ${re}
        </div>
      `}return`
      <div class="graph-family-card" id="graph-family-${r(f)}">
        <button class="graph-family-header" type="button" data-graph-family-toggle="${r(f)}">
          <span class="graph-family-label">${r(v)}</span>
          <span class="graph-family-counts">${r(P)} | ${r(B)} | ${r(R)}</span>
          <span class="graph-family-chevron">${g}</span>
        </button>
        ${C}
      </div>
    `}).join("");return`
    <div class="viewer-stack graph-view">
      ${l}
      <div class="graph-family-list">
        ${u||'<p class="muted">No event families matched the current search.</p>'}
      </div>
    </div>
  `}function ea(e){if(!e)return null;const t=ie(e),a=ue(e),s=it(t,e);return s&&t?.scenePath?{key:`scene-frame:${t.scenePath}:${s.assetPath}`,title:"Loading preview"}:M(e)&&t?.previewKind==="flipbook"&&t.frames?.length===1?{key:`scene-frame:${t.scenePath}:${t.frames[0].assetPath}`,title:"Loading preview"}:M(e)&&t?.previewKind==="video"&&t.previewAssetPath?{key:`scene-video:${t.scenePath}:${t.previewAssetPath}`,title:"Loading video preview"}:M(e)&&n.sceneLoadingByPath[a]?null:e.previewKind==="image"?{key:`asset-preview:${e.path}`,title:"Loading preview"}:e.previewKind==="audio"?{key:`asset-preview:${e.path}`,title:"Loading audio preview"}:e.previewKind==="video"?{key:`asset-preview:${e.path}`,title:"Loading video preview"}:null}function Fe(){if(!n.currentData||n.loading||n.error)return null;if(F()){const e=ae();return!e||e.byteLength<=0||!n.soundPreviewPreparedByScript[e.scriptIndex]?null:{key:`sound-media:${e.scriptIndex}`,title:"Loading audio preview"}}return ea(U())}function Ot(e){return!e?.key||n.previewLoadedByKey[e.key]||n.previewLoadingByKey[e.key]?!1:(n.previewLoadingByKey[e.key]=e,!0)}function zt(e){e&&(n.previewLoadedByKey[e]=!0,n.previewLoadingByKey[e]&&(delete n.previewLoadingByKey[e],k()))}function ta(){const e=Fe();e&&Ot(e)&&k()}function Ce(e){const t=n.previewLoadingByKey[e];return t?`
    <div class="preview-loading-overlay" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <div class="placeholder-copy">
        <strong>${r(t.title)}</strong>
        <span>${r(t.detail)}</span>
      </div>
    </div>
  `:""}function na(){const e=j.querySelector("[data-preview-load-key]");if(!e)return;const t=e.dataset.previewLoadKey;if(!t||!n.previewLoadingByKey[t])return;const a=()=>{zt(t)},s=e.tagName;if(s==="IMG"){if(e.complete&&e.naturalWidth>0){a();return}e.addEventListener("load",a,{once:!0}),e.addEventListener("error",a,{once:!0});return}if(s==="AUDIO"){if(e.readyState>=1){a();return}e.addEventListener("loadedmetadata",a,{once:!0}),e.addEventListener("error",a,{once:!0});return}if(s==="VIDEO"){if(e.readyState>=2){a();return}e.addEventListener("loadeddata",a,{once:!0}),e.addEventListener("error",a,{once:!0})}}function At(e,t){const a=Fe(),s=a?Ce(a.key):"",i=s?" is-loading":"";let c=e;if(n.videoReplaceAssetPath&&e.includes(encodeURIComponent(n.videoReplaceAssetPath))){const o=e.includes("?")?"&":"?";c=`${e}${o}_t=${Date.now()}`}return`
    <div class="preview-surface preview-surface-video${i}" data-preview-kind="video">
      <div class="preview-video-frame">
        <video class="preview-video" autoplay muted controls playsinline preload="metadata" src="${c}" aria-label="${r(t)}" data-preview-load-key="${r(a?.key||"")}"></video>
      </div>
      ${s}
    </div>
  `}function aa(e){if(!e||e.readyState<2||!e.videoWidth||!e.videoHeight)return null;const t=document.createElement("canvas");t.width=e.videoWidth,t.height=e.videoHeight;const a=t.getContext("2d");if(!a)return null;try{return a.drawImage(e,0,0,t.width,t.height),t.toDataURL("image/png")}catch{return null}}function sa(){const e=j.querySelector(".preview-surface-video"),t=e?.querySelector(".preview-video");if(!e||!t)return null;const a=aa(t),s=e.getBoundingClientRect();return!a||s.height<=0?null:{frameUrl:a,height:Math.round(s.height)}}function ia(e){e&&(e.classList.remove("is-transitioning"),e.style.removeProperty("--preview-surface-fixed-height"))}function ra(e,t,a){a&&(a.classList.remove("is-pending"),a.classList.add("is-ready")),requestAnimationFrame(()=>{t.classList.add("is-fading")}),window.setTimeout(()=>{t.remove(),ia(e)},180)}function Ye(){A.previewTransitionTimer!==null&&(window.clearTimeout(A.previewTransitionTimer),A.previewTransitionTimer=null)}function oa(e){if(Ye(),!e?.frameUrl)return;const t=j.querySelector(".preview-surface-video");if(!t)return;t.classList.add("is-transitioning"),t.style.setProperty("--preview-surface-fixed-height",`${e.height}px`);const a=document.createElement("img");a.className="preview-transition-frame",a.alt="",a.setAttribute("aria-hidden","true"),a.src=e.frameUrl,t.appendChild(a);const s=t.querySelector(".preview-video"),i=()=>{a.isConnected&&(s&&(s.removeEventListener("loadeddata",i),s.removeEventListener("error",i)),Ye(),ra(t,a,s))};if(s&&s.readyState<2){s.classList.remove("is-ready"),s.classList.add("is-pending"),s.addEventListener("loadeddata",i,{once:!0}),s.addEventListener("error",i,{once:!0}),A.previewTransitionTimer=window.setTimeout(i,900);return}i()}function ut(e){const t=n.soundPreviewRevisionByScript[e]||0;return`/api/sound-preview?path=${encodeURIComponent(E.value.trim())}&script=${encodeURIComponent(e)}&rev=${encodeURIComponent(t)}`}function ca(e){return`/api/sound-export?path=${encodeURIComponent(E.value.trim())}&script=${encodeURIComponent(e)}`}function Xt(e){if(!e||e.byteLength<=0)return null;const t=n.soundPreviewRevisionByScript[e.scriptIndex]||0;return{key:`sound-preview:${e.scriptIndex}:${t}`,title:"Loading Audio..."}}function da(e){const t=(n.soundPreviewRevisionByScript[e]||0)+1;n.soundPreviewRevisionByScript[e]=t,delete n.soundPreviewPreparedByScript[e],delete n.soundPreviewLoadingByScript[e],delete n.previewLoadingByKey[`sound-preview:${e}:${t-1}`],delete n.previewLoadedByKey[`sound-preview:${e}:${t-1}`],Q.has(e)&&Q.delete(e),$.soundRowPlayerScriptIndex===e&&He({clearSource:!0})}function Ke(){En()}function He({clearSource:e=!1}={}){$.soundRowPlayer.pause(),$.soundRowPlayer.currentTime=0,$.soundRowPlayerScriptIndex=null,n.playingSoundScriptIndex=null,e&&($.soundRowPlayer.removeAttribute("src"),$.soundRowPlayer.load())}function je(){const e=!$.soundRowPlayer.paused&&$.soundRowPlayerScriptIndex!==null?$.soundRowPlayerScriptIndex:null;n.playingSoundScriptIndex!==e&&(n.playingSoundScriptIndex=e,pe()||k())}function pe(){if(!N||!F())return!1;const e=new Map(Le().map(t=>[t.scriptIndex,t]));for(const t of N.querySelectorAll(".sound-row")){const a=t.querySelector("[data-sound-script]"),s=t.querySelector("[data-sound-play]"),i=t.querySelector("[data-sound-stop]"),c=Number(a?.dataset.soundScript??t.dataset.soundScriptRow),o=e.get(c),d=c===n.selectedSoundScriptIndex,l=c===n.playingSoundScriptIndex,u=!!n.soundPreviewLoadingByScript[c],p=(o?.byteLength||0)>0;if(t.classList.toggle("is-selected",d),t.classList.toggle("is-playing",l),t.classList.toggle("is-loading",u),a?.classList.toggle("is-selected",d),s){const f=o?.label||`Script ${c}`,v=u?`Preparing ${f}`:`Play ${f}`;s.disabled=!p||u,s.setAttribute("aria-label",v),s.title=v;const w=u?"spinner":"play";s.dataset.iconKind!==w&&(s.dataset.iconKind=w,s.innerHTML=J(w))}i&&(i.disabled=!l)}return!0}function Je(){return!n.currentData||n.loading||n.error||!F()?!1:(pe(),k(),!0)}async function Yt(e){const t=Me(e);if(!t||t.byteLength<=0)return!1;if(n.soundPreviewPreparedByScript[e])return!0;if(Q.has(e))return Q.get(e);const a=G,s=Xt(t);s&&Ot(s),n.soundPreviewLoadingByScript[e]=!0,Je()||k();const i=fetch(ut(e),{method:"HEAD",cache:"no-store"}).then(c=>{if(!c.ok)throw new Error(`Sound preview prepare failed (${c.status})`);return a!==G?!1:(n.soundPreviewPreparedByScript[e]=!0,!0)}).catch(c=>(a===G&&(n.soundActionError=c.message||"Sound preview prepare failed"),!1)).finally(()=>{Q.delete(e),a===G&&(delete n.soundPreviewLoadingByScript[e],zt(s?.key),Je()||k())});return Q.set(e,i),i}function la(){if(!F()||n.loading||n.error)return;const e=ae();!e||e.byteLength<=0||n.soundPreviewPreparedByScript[e.scriptIndex]||n.soundPreviewLoadingByScript[e.scriptIndex]||Yt(e.scriptIndex)}async function ua(e){const t=Me(e);if(!t||t.byteLength<=0)return;Ke();const a=$e;if(n.selectedSoundScriptIndex=e,n.soundActionError="",pe(),qe(),!await Yt(e)||a!==$e||n.selectedSoundScriptIndex!==e)return;const i=ut(e),c=new URL(i,window.location.href).href,o=$.soundRowPlayerScriptIndex!==e||$.soundRowPlayer.currentSrc!==c;$.soundRowPlayerScriptIndex=e,o&&($.soundRowPlayer.src=i),$.soundRowPlayer.currentTime=0;try{if(await $.soundRowPlayer.play(),a!==$e||n.selectedSoundScriptIndex!==e){He(),k();return}}catch(d){$.soundRowPlayerScriptIndex=null,n.playingSoundScriptIndex=null,n.soundActionError=d.message||"Sound playback failed",k()}}function pa(e){Ke(),!($.soundRowPlayerScriptIndex!==e&&n.playingSoundScriptIndex!==e)&&(He(),pe()||k())}async function fa(e){const t=ae();if(!(!t||!e)){n.soundActionPending=!0,n.soundActionError="",k();try{const a=await fetch(`/api/sound-replace?path=${encodeURIComponent(E.value.trim())}&script=${encodeURIComponent(t.scriptIndex)}`,{method:"POST",headers:{"Content-Type":e.type||"audio/wav"},body:e}),s=await a.json();if(!a.ok)throw new Error(s.error||"Sound replace failed");da(t.scriptIndex)}catch(a){n.soundActionError=a.message}finally{n.soundActionPending=!1,k()}}}function ee(){A.activeAnimationTimer!==null&&(window.clearInterval(A.activeAnimationTimer),A.activeAnimationTimer=null)}function ma(e){const t=Dt(e),a=r(H(e)||"Decoded sound scripts");if(!e||!t)return`<h2>${a}</h2>`;if(n.inlineAssetEditorPath===t){const i=n.assetMetadataDraftByPath[t]||{},c=n.assetMetadataPendingPath===t;return`
      <form class="preview-title-edit-form" data-inline-asset-title-form data-inline-asset-path="${r(t)}">
        <input
          class="preview-title-input"
          type="text"
          spellcheck="false"
          value="${r(i.alias||H(e))}"
          data-inline-asset-alias-input
          ${c?"disabled":""}
        >
        <button
          class="asset-edit-button"
          type="submit"
          aria-label="Save asset name"
          title="Save asset name"
          ${c?"disabled":""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M6.6 11.2 3.4 8l-1.1 1.1 4.3 4.3 7.1-7.1-1.1-1.1z" fill="currentColor"></path>
          </svg>
        </button>
        <button
          class="asset-edit-button"
          type="button"
          data-cancel-inline-asset-edit="${r(t)}"
          aria-label="Cancel asset name edit"
          title="Cancel"
          ${c?"disabled":""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m4.1 3 3.9 3.9L11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1z" fill="currentColor"></path>
          </svg>
        </button>
      </form>
    `}return`
    <div class="preview-title-row" data-edit-asset-metadata="${r(t)}" title="Double-click to edit name">
      <h2>
        <span class="preview-title-text">${a}</span>
        <button
          class="asset-edit-button asset-edit-button-inline"
          type="button"
          data-edit-asset-metadata="${r(t)}"
          aria-label="Edit asset name"
          title="Edit asset name"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M11.8 1.8a1.7 1.7 0 0 1 2.4 2.4l-7.9 7.9-3.6.8.8-3.6 7.9-7.9Zm1.4 1-1.4-1.4a.5.5 0 0 0-.7 0L10 2.5l2.1 2.1 1.1-1.1a.5.5 0 0 0 0-.7ZM11.3 5.3 9.2 3.2 4 8.4l-.5 2 2-.5 5.8-5.8Z" fill="currentColor"></path>
          </svg>
        </button>
      </h2>
    </div>
  `}function ga(e){return e.map(t=>{const a=Dt(t),s=t.scriptIndex===n.selectedSoundScriptIndex,i=t.scriptIndex===n.playingSoundScriptIndex,c=!!n.soundPreviewLoadingByScript[t.scriptIndex],o=t.byteLength>0,d=H(t),u=[se(t),et(t),Pe(t.durationMs),`codec ${t.codec}`].filter(Boolean);return n.sidebarInlineAssetEditorPath===a?`
        <div class="sound-row${s?" is-selected":""}${i?" is-playing":""}${c?" is-loading":""} is-editing" data-sound-script-row="${t.scriptIndex}">
          ${Ee(a,d,`<div class="asset-subtitle">${r(u.join(" | "))}</div>`)}
          <div class="sound-row-actions">
            <button class="row-action-button row-action-icon-button" type="button" data-sound-play="${t.scriptIndex}" aria-label="${c?`Preparing ${r(d)}`:`Play ${r(d)}`}" title="${c?`Preparing ${r(d)}`:`Play ${r(d)}`}" ${o&&!c?"":"disabled"}>
              ${J(c?"spinner":"play")}
            </button>
            <button class="row-action-button row-action-icon-button" type="button" data-sound-stop="${t.scriptIndex}" aria-label="Stop ${r(d)}" title="Stop ${r(d)}" ${i?"":"disabled"}>
              ${J("stop")}
            </button>
          </div>
        </div>
      `:`
      <div class="sound-row${s?" is-selected":""}${i?" is-playing":""}${c?" is-loading":""}">
        <button class="asset-row sound-row-select${s?" is-selected":""}" type="button" data-sound-script="${t.scriptIndex}" data-edit-sidebar-asset-path="${r(a)}">
          <div class="asset-row-top">
            <span class="asset-title">${r(d)}</span>
          </div>
          <div class="asset-subtitle">
            ${r(u.join(" | "))}
          </div>
        </button>
        <div class="sound-row-actions">
          <button class="row-action-button row-action-icon-button" type="button" data-sound-play="${t.scriptIndex}" aria-label="${c?`Preparing ${r(d)}`:`Play ${r(d)}`}" title="${c?`Preparing ${r(d)}`:`Play ${r(d)}`}" ${o&&!c?"":"disabled"}>
            ${J(c?"spinner":"play")}
          </button>
          <button class="row-action-button row-action-icon-button" type="button" data-sound-stop="${t.scriptIndex}" aria-label="Stop ${r(d)}" title="Stop ${r(d)}" ${i?"":"disabled"}>
            ${J("stop")}
          </button>
        </div>
      </div>
    `}).join("")}function Jt(e,{includeInput:t=!1}={}){return e?`
    <div class="inline-actions preview-header-actions">
      <a class="link-button" href="${ca(e.scriptIndex)}" download>Download</a>
      <button class="link-button" type="button" data-sound-replace>${n.soundActionPending?"Replacing...":"Replace"}</button>
      ${t?`<input id="soundReplaceInput" type="file" accept=".wav,audio/wav" hidden ${n.soundActionPending?"disabled":""}>`:""}
    </div>
  `:""}function ha(e){if(!e){const s=n.currentData?.spike?.soundError;return`
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>${s?"Sound decode failed":"No sound script selected"}</strong>
          <span>${r(s||"Pick a script from the left rail to preview or export it.")}</span>
        </div>
      </div>
    `}if(e.byteLength<=0)return`
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>No audible payload</strong>
          <span>This script has no exported PCM frames.</span>
        </div>
      </div>
    `;if(n.soundPreviewLoadingByScript[e.scriptIndex]){const s=Xt(e);return`
      <div class="preview-surface preview-surface-loading">
        ${Ce(s?.key)}
      </div>
    `}const t=Fe(),a=t?Ce(t.key):"";return`
    <div class="preview-surface${a?" is-loading":""}">
      <audio controls preload="metadata" src="${ut(e.scriptIndex)}" data-preview-load-key="${r(t?.key||"")}"></audio>
      ${a}
    </div>
  `}function va(){const e=ae(),t=at();n.currentData?.spike?.soundError;const a=H(e),s=se(e);return`
    <div class="viewer-stack">
      <section class="preview-stage">
        <div class="preview-header">
          <div class="preview-header-main">
            ${ma(e)}
          </div>
          ${Jt(e,{includeInput:!0})}
        </div>
        ${ha(e)}
        ${n.soundActionError?`<div class="error-state"><strong>Sound action failed</strong><p>${r(n.soundActionError)}</p></div>`:""}
      </section>

      <section class="two-col">
        <article class="panel">
          <h3>Sound system</h3>
          ${t?D([["Sample rate",`${y(t.sampleRate)} Hz`],["Requests",y(t.requestCount)],["Scripts",y(t.scriptCount)],["Fragments",y(t.fragmentCount)]]):'<p class="muted">No sound-system metadata was decoded for this target.</p>'}
        </article>
        <article class="panel">
          <h3>Selected script</h3>
          ${e?D([["Name",`<code>${r(a)}</code>`],["Script id",`<code>${r(s||`Script ${e.scriptIndex}`)}</code>`],["Request index",y(e.requestIndex)],["Channels",`<code>${r(et(e))}</code>`],["Duration",Pe(e.durationMs)],["Codec",`<code>${r(e.codec)}</code>`],["Fragments",y(e.fragmentCount)],["PCM frames",y(e.byteLength)]]):'<p class="muted">Select a sound script to inspect its decoded metadata.</p>'}
        </article>
      </section>
    </div>
  `}function ya(){$.soundRowPlayer.addEventListener("play",je),$.soundRowPlayer.addEventListener("pause",je),$.soundRowPlayer.addEventListener("ended",je)}async function wa(e){if(!(!e||n.sceneLoadingByPath[e])){n.sceneLoadingByPath[e]=!0;try{const t=await fetch(`/api/scene-metadata?path=${encodeURIComponent(E.value.trim())}&scene=${encodeURIComponent(e)}`),a=await t.json();if(!t.ok)throw new Error(a.error||"Scene decode failed");n.sceneDetailsByPath[e]=a;const s=K().find(i=>i.path===e);s&&(s.sceneType=a.sceneType||s.sceneType)}catch(t){n.sceneDetailsByPath[e]={scenePath:e,sceneType:"RawScene",previewKind:null,error:t.message}}finally{delete n.sceneLoadingByPath[e],Qt(),k()}}}function ba(){if(F()||n.loading||n.error)return;const e=U(),t=ue(e);t&&(n.sceneDetailsByPath[t]||n.sceneLoadingByPath[t]||wa(t))}async function pt(e){if(!e||n.radiumSceneLoadingByPath?.[e])return;n.radiumSceneLoadingByPath=n.radiumSceneLoadingByPath||{},n.radiumSceneLoadingByPath[e]=!0;const t=E.value.trim();try{const s=await(await fetch(`/api/radium-scene?path=${encodeURIComponent(t)}&scene=${encodeURIComponent(e)}`)).json();if(s.error)throw new Error(s.error);const i=Object.keys(n.radiumScenesByPath);for(;i.length>=In;){const c=i.shift();delete n.radiumScenesByPath[c]}n.radiumScenesByPath[e]=s}catch(a){console.error("Failed to load radium scene:",e,a),n.radiumScenesByPath[e]={error:a.message}}finally{delete n.radiumSceneLoadingByPath[e]}k()}function Sa(e){return e?.sceneType!=="StreamingFlipbook"||!e.clipFrames?.length||e.clipFrames.length<2?"":`
    <div class="clip-preview">
      <div class="preview-surface">
        <img id="clipPlayerImage" class="preview-image" alt="${r(e.sceneLabel||e.path)}">
      </div>
      <div class="clip-controls">
        <button type="button" id="clipPlayToggle">Pause</button>
        <label class="checkline" for="clipFps">
          <span>FPS</span>
          <input id="clipFps" type="range" min="2" max="24" step="1" value="12">
          <strong id="clipFpsValue">12</strong>
        </label>
      </div>
      <p id="clipFrameStatus" class="muted"></p>
    </div>
  `}function $a(e){return e?.previewKind!=="flipbook"||!e.frames?.length?"":`
    <div class="clip-preview">
      <div class="preview-surface">
        <img id="clipPlayerImage" class="preview-image" alt="${r(L(e.scenePath))}">
      </div>
      <div class="clip-controls">
        <button type="button" id="clipPlayToggle">Pause</button>
        <label class="checkline" for="clipFps">
          <span>FPS</span>
          <input id="clipFps" type="range" min="2" max="24" step="1" value="12">
          <strong id="clipFpsValue">12</strong>
        </label>
      </div>
      <p id="clipFrameStatus" class="muted"></p>
    </div>
  `}function Pa(e){ee();const t=document.getElementById("clipPlayerImage"),a=document.getElementById("clipPlayToggle"),s=document.getElementById("clipFps"),i=document.getElementById("clipFpsValue"),c=document.getElementById("clipFrameStatus");if(!t||!a||!s||!i||!c)return;const o=e.clipFrames.map(v=>K().find(w=>w.path===v)).filter(Boolean);if(!o.length)return;let d=Math.min(e.clipFrameIndex||0,o.length-1),l=!0;const u=()=>{const v=o[d];t.src=ot(v),c.textContent=`${e.sceneLabel||"Clip"} frame ${d+1} of ${o.length} (${L(v.path)})`},p=()=>{ee(),A.activeAnimationTimer=window.setInterval(()=>{d=(d+1)%o.length,u()},Math.max(40,Math.round(1e3/Number(s.value||12)))),a.textContent="Pause",l=!0},f=()=>{ee(),a.textContent="Play",l=!1};s.addEventListener("input",()=>{i.textContent=s.value,l&&p()}),a.addEventListener("click",()=>{if(l){f();return}p()}),u(),p()}function Ia(e){ee();const t=document.getElementById("clipPlayerImage"),a=document.getElementById("clipPlayToggle"),s=document.getElementById("clipFps"),i=document.getElementById("clipFpsValue"),c=document.getElementById("clipFrameStatus");if(!t||!a||!s||!i||!c)return;const o=e.frames||[];if(!o.length)return;let d=0,l=!0;const u=()=>{const v=o[d];t.src=Ie(e.scenePath,v.assetPath),c.textContent=`${L(e.scenePath)} frame ${d+1} of ${o.length} (${L(v.assetPath)})`},p=()=>{ee(),A.activeAnimationTimer=window.setInterval(()=>{d=(d+1)%o.length,u()},Math.max(40,Math.round(1e3/Number(s.value||12)))),a.textContent="Pause",l=!0},f=()=>{ee(),a.textContent="Play",l=!1};s.addEventListener("input",()=>{i.textContent=s.value,l&&p()}),a.addEventListener("click",()=>{if(l){f();return}p()}),u(),p()}function Ea(e){const t=n.radiumScenesByPath[e];return!t||t.error?`
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>Radium scene error</strong>
          <span>${r(t?.error||"Unknown error")}</span>
        </div>
      </div>
    `:`
    <div class="radium-player-container" data-radium-scene="${r(e)}">
      <canvas id="radiumCanvas"></canvas>
      <div class="radium-controls">
        <button id="radiumPlayPause" type="button" title="Play / Pause">Play</button>
        <button id="radiumStepBack" type="button" title="Step back">&lt;</button>
        <button id="radiumStepFwd" type="button" title="Step forward">&gt;</button>
        <input id="radiumTimeline" type="range" min="0" max="1" step="1" value="0" title="Timeline">
        <span class="radium-frame-display" id="radiumFrameDisplay">Frame 0 / 0</span>
        <div class="radium-speed">
          <span>Speed</span>
          <input id="radiumSpeed" type="range" min="1" max="30" step="1" value="10" title="Playback speed">
          <span class="radium-speed-value" id="radiumSpeedValue">1.0x</span>
        </div>
        <label><input id="radiumLoop" type="checkbox" checked> Loop</label>
      </div>
    </div>
  `}function ft(){$.activeRadiumPlayer&&($.activeRadiumPlayer.destroy(),$.activeRadiumPlayer=null)}async function Ba(){const e=document.querySelector(".radium-player-container[data-radium-scene]");if(!e)return;const t=e.dataset.radiumScene,a=n.radiumScenesByPath[t];if(!a||a.error)return;const s=document.getElementById("radiumCanvas"),i=document.getElementById("radiumPlayPause"),c=document.getElementById("radiumStepBack"),o=document.getElementById("radiumStepFwd"),d=document.getElementById("radiumTimeline"),l=document.getElementById("radiumFrameDisplay"),u=document.getElementById("radiumSpeed"),p=document.getElementById("radiumSpeedValue"),f=document.getElementById("radiumLoop");if(!s||!i)return;ft();const v=E.value.trim(),w=`/api/radium-image?path=${encodeURIComponent(v)}&scene=${encodeURIComponent(t)}`,g=new window.RadiumPlayer(s,a.composition,a.imageManifest,w);$.activeRadiumPlayer=g,d.max=String(Math.max(0,g.frameCount-1)),l.textContent=`Frame 0 / ${g.frameCount}`,g.onFrameChange=b=>{d.value=String(b),l.textContent=`Frame ${b+1} / ${g.frameCount}`,i.textContent=g.playing?"Pause":"Play"},i.addEventListener("click",()=>{g.playing?(g.pause(),i.textContent="Play"):(g.play(),i.textContent="Pause")}),c.addEventListener("click",()=>{g.pause(),g.step(-1),i.textContent="Play"}),o.addEventListener("click",()=>{g.pause(),g.step(1),i.textContent="Play"}),d.addEventListener("input",()=>{g.seekFrame(Number(d.value))}),u.addEventListener("input",()=>{const b=Number(u.value)/10;g.speedFactor=b,p.textContent=`${b.toFixed(1)}x`}),f.addEventListener("change",()=>{g.loop=f.checked}),await g.loadImages(),g.seekFrame(0)}function Zt(e){if(!e)return`
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>No asset selected</strong>
          <span>Inspect a target and choose an asset from the left rail.</span>
        </div>
      </div>
    `;const t=ie(e),a=it(t,e),s=Fe(),i=s?Ce(s.key):"",c=i?" is-loading":"";if(M(e)&&t?.previewKind==="flipbook"&&t.frames?.length>1)return $a(t);if(a)return`<div class="preview-surface${c}"><img class="preview-image" src="${Ie(t.scenePath,a.assetPath)}" alt="${r(a.assetPath)}" data-preview-load-key="${r(s?.key||"")}">${i}</div>`;if(M(e)&&t?.previewKind==="flipbook"&&t.frames?.length===1)return`<div class="preview-surface${c}"><img class="preview-image" src="${Ie(t.scenePath,t.frames[0].assetPath)}" alt="${r(t.scenePath)}" data-preview-load-key="${r(s?.key||"")}">${i}</div>`;if(M(e)&&t?.previewKind==="video"&&t.previewAssetPath)return At(X(t.previewAssetPath),t.scenePath);if(M(e)&&n.sceneLoadingByPath[ue(e)])return`
      <div class="preview-surface">
        <div class="placeholder-copy">
          <strong>Decoding scene</strong>
        </div>
      </div>
    `;if(M(e)&&n.selectedSceneNodeId&&n.selectedSceneNodeScenePath){let v=function(w){const g=dt(d,l),b=g||w.label;if(n.inlineAssetEditorPath===f){const B=n.assetMetadataDraftByPath[f]||{},R=B.alias!==void 0?B.alias:b,C=n.assetMetadataPendingPath===f;return`
          <form class="scene-node-rename-form" data-scene-node-rename-form data-scene-node-rename-path="${r(f)}">
            <input
              class="scene-node-rename-input"
              type="text"
              spellcheck="false"
              value="${r(R)}"
              data-scene-node-rename-input
              ${C?"disabled":""}
              autofocus
            >
            <button class="link-button" type="submit" ${C?"disabled":""}>Save</button>
            <button class="link-button" type="button" data-scene-node-rename-cancel="${r(f)}">Cancel</button>
          </form>
          ${g?`<span class="muted" style="font-size:11px">Original: ${r(w.label)}</span>`:""}
        `}return`
        <div class="scene-node-name-row">
          <strong>${r(b)}</strong>
          <button class="asset-edit-button asset-edit-button-compact" type="button" data-scene-node-rename-start="${r(f)}" title="Rename">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
        </div>
        ${g?`<span class="muted" style="font-size:11px">Original: ${r(w.label)}</span>`:""}
      `};const d=n.selectedSceneNodeScenePath,l=n.selectedSceneNodeId,u=n.radiumScenesByPath[d],p='<div class="scene-tree-back"><button class="link-button" type="button" data-back-to-scene="1">← Back to scene player</button></div>',f=tt(d,l);if(u&&!u.error){const w=u.assetTree,g=w?.images?.find(I=>I.id===l);if(g){const I=`/api/radium-image?path=${encodeURIComponent(E.value.trim())}&scene=${encodeURIComponent(d)}&image=${encodeURIComponent(l)}`,z=n.imageReplaceSuccess===l,re=`
          <div class="scene-tree-replace-controls">
            <span class="badge kind-badge">${r(g.format)}, ${g.width}×${g.height}${g.isExternal?", external":", embedded"}</span>
          </div>
        `;return`${p}<div class="scene-node-detail">${v(g)}</div>${re}<div class="preview-surface"><img class="preview-image" src="${I}${z?`&_t=${Date.now()}`:""}" alt="${r(g.label)}"></div>`}const b=w?.sounds?.find(I=>I.id===l);if(b)return`${p}<div class="scene-node-detail">${v(b)}</div><div class="preview-surface"><div class="placeholder-copy"><span>Sample rate: ${y(b.sampleRate)} Hz</span><span>Channels: ${b.channels===2?"Stereo":"Mono"}</span><span>Sample size: ${b.sampleSize}-bit</span><span>Compression: ${b.compression}</span></div></div>`;const P=w?.videoClips?.find(I=>I.id===l);if(P)return`${p}<div class="scene-node-detail">${v(P)}</div><div class="preview-surface"><div class="placeholder-copy"><span>Dimensions: ${r(P.dimensions)}</span><span>Frames: ${y(P.frameCount)}</span>${P.fileName?`<span>File: ${r(P.fileName)}</span>`:""}</div></div>`;const B=w?.fonts?.find(I=>I.id===l);if(B)return`${p}<div class="scene-node-detail">${v(B)}</div><div class="preview-surface"><div class="placeholder-copy"><span>Style: ${B.bold?"Bold":""}${B.italic?" Italic":""}${!B.bold&&!B.italic?"Regular":""}</span><span>Glyphs: ${y(B.glyphCount)}</span></div></div>`;const R=w?.spineAssets?.find(I=>I.id===l);if(R)return`${p}<div class="scene-node-detail">${v(R)}</div><div class="preview-surface"><div class="placeholder-copy"><span>Type: Spine character</span><span>Images: ${y(R.imageCount)}</span></div></div>`;const C=w?.texts?.find(I=>I.id===l);if(C)return`${p}<div class="scene-node-detail">${v(C)}</div><div class="preview-surface"><div class="placeholder-copy"><span>${r(C.text||"(empty)")}</span></div></div>`}return`${p}<div class="preview-surface"><div class="placeholder-copy"><strong>Asset preview unavailable</strong></div></div>`}if(M(e)){const d=ue(e);if(d)return n.radiumScenesByPath[d]?Ea(d):(n.radiumSceneLoadingByPath?.[d]||pt(d),`
        <div class="preview-surface">
          <div class="placeholder-copy">
            <strong>Loading Radium scene</strong>
          </div>
        </div>
      `)}if(e.sceneType==="StreamingFlipbook"&&e.clipFrames?.length>1)return Sa(e);const o=ot(e);if(e.previewKind==="image")return`<div class="preview-surface${c}"><img class="preview-image" src="${o}" alt="${r(e.path)}" data-preview-load-key="${r(s?.key||"")}">${i}</div>`;if(e.previewKind==="audio")return`<div class="preview-surface${c}"><audio controls preload="metadata" src="${o}" data-preview-load-key="${r(s?.key||"")}"></audio>${i}</div>`;if(e.previewKind==="video")return At(o,e.path);if(e.kind==="font"){const d=`preview-${Math.random().toString(36).slice(2)}`;return`
      <style>
        @font-face {
          font-family: '${d}';
          src: url('${o}');
        }
      </style>
      <div class="preview-surface">
        <div class="font-preview" style="font-family: '${d}', serif;">Stern Spike Preview 0123456789</div>
      </div>
    `}return`
    <div class="preview-surface">
      <div class="placeholder-copy">
        <strong>No inline preview</strong>
        <span>${r(e.format||e.kind||"Unknown type")} is available as raw data only.</span>
      </div>
    </div>
  `}function La(e){return e.map(t=>{const{scene:a,asset:s}=t;if(!s)return"";if(t.rowType==="asset"){const u=s.path===n.selectedAssetPath,p=Un(s.path,a.scenePath);return n.sidebarInlineAssetEditorPath===s.path?`
          <div class="scene-row${u?" is-selected":""} is-editing">
            ${Ee(s.path,L(s),`<div class="scene-subtitle">${r(p)}</div>`)}
          </div>
        `:`
        <button class="scene-row${u?" is-selected":""}" type="button" data-scene-asset="${r(s.path)}" data-edit-sidebar-asset-path="${r(s.path)}" title="${r(s.path)}">
          <div class="scene-row-top">
            <span class="scene-title">${r(L(s))}</span>
            <span class="badge kind-badge">${r(a.sceneType)}</span>
          </div>
          <div class="scene-subtitle">${r(p)}</div>
        </button>
      `}const i=s.path===n.selectedAssetPath||a.scenePath===U()?.scenePath,c=a.assets.length?`${y(a.assets.length)} previewable assets${a.clipLabels.length?`, ${y(a.clipLabels.length)} clips`:""}`:"Raw scene file",o=n.sidebarInlineAssetEditorPath===a.scenePath,d=!!n.expandedScenePaths[a.scenePath],l=d?"▾":"▸";return o?`
        <div class="scene-row${i?" is-selected":""} is-editing">
          ${Ee(a.scenePath,L(a.scenePath),`<div class="scene-subtitle">${r(c)}</div>`)}
        </div>
      `:`
      <div class="scene-row-wrapper">
        <div class="scene-row-header">
          <button class="scene-tree-toggle" type="button" data-scene-tree-toggle="${r(a.scenePath)}" title="Expand asset tree">${l}</button>
          <button class="scene-row${i?" is-selected":""}" type="button" data-scene-asset="${r(s.path)}" data-edit-sidebar-asset-path="${r(a.scenePath)}">
            <div class="scene-row-top">
              <span class="scene-title">${r(L(a.scenePath))}</span>
              <span class="badge kind-badge">${r(a.sceneType)}</span>
            </div>
            <div class="scene-subtitle">${c}</div>
          </button>
        </div>
        ${d?ka(a.scenePath):""}
      </div>
    `}).join("")}function ka(e){const t=n.radiumScenesByPath[e];if(!t)return n.radiumSceneLoadingByPath?.[e]?'<div class="scene-tree"><div class="scene-tree-loading muted">Loading asset tree…</div></div>':'<div class="scene-tree"><div class="scene-tree-loading muted">Expanding…</div></div>';if(t.error)return`<div class="scene-tree"><div class="scene-tree-loading muted">Error: ${r(t.error)}</div></div>`;const a=t.assetTree;if(!a)return'<div class="scene-tree"><div class="scene-tree-loading muted">No asset tree available</div></div>';function s(o){return dt(e,o.id)||o.label}const i=[["Images",a.images,o=>`<span class="scene-tree-label">${r(s(o))}</span><span class="badge kind-badge">${r(o.format)}, ${o.width}×${o.height}</span>`],["Sounds",a.sounds,o=>`<span class="scene-tree-label">${r(s(o))}</span><span class="badge kind-badge">${y(o.sampleRate)}Hz, ${o.channels===2?"stereo":"mono"}</span>`],["Video Clips",a.videoClips,o=>`<span class="scene-tree-label">${r(s(o))}</span><span class="badge kind-badge">${r(o.dimensions)}, ${y(o.frameCount)} frames</span>`],["Fonts",a.fonts,o=>`<span class="scene-tree-label">${r(s(o))}${o.bold?" Bold":""}${o.italic?" Italic":""}</span><span class="badge kind-badge">${y(o.glyphCount)} glyphs</span>`],["Spine",a.spineAssets,o=>`<span class="scene-tree-label">${r(s(o))}</span><span class="badge kind-badge">${y(o.imageCount)} images</span>`],["Text Fields",a.texts,o=>`<span class="scene-tree-label">${r(s(o))}</span><span class="badge kind-badge">${r(o.text||"(empty)")}</span>`]];return i.some(([,o])=>o.length>0)?`<div class="scene-tree">${i.map(([o,d,l])=>d.length?`
      <div class="scene-tree-group">
        <div class="scene-tree-group-header">${r(o)} <span class="count-pill">${y(d.length)}</span></div>
        ${d.map(u=>{const p=tt(e,u.id);return n.sidebarInlineAssetEditorPath===p?`
              <div class="scene-tree-node is-editing">
                ${Ee(p,u.label)}
              </div>
            `:`
            <button class="scene-tree-node${n.selectedSceneNodeId===u.id?" is-selected":""}" type="button" data-scene-tree-node="${r(u.id)}" data-scene-tree-node-scene="${r(e)}" data-edit-sidebar-asset-path="${r(p)}">
              ${l(u)}
            </button>
          `}).join("")}
      </div>
    `:"").join("")}</div>`:'<div class="scene-tree"><div class="scene-tree-loading muted">No assets found in scene</div></div>'}function Aa(){const e=U();return`
    <div class="viewer-stack">
      <section class="preview-stage preview-stage-seamless">
        <div class="preview-header">
          <div class="preview-header-main">
            ${en(e,"Radium scenes")}
          </div>
          ${Ra(e)}
        </div>
        ${Zt(e)}
      </section>
    </div>
  `}function Ra(e){const t=n.selectedSceneNodeScenePath,a=n.selectedSceneNodeId;if((t?n.radiumScenesByPath[t]:null)?.assetTree?.images?.find(o=>o.id===a)){const o=`/api/radium-image?path=${encodeURIComponent(E.value.trim())}&scene=${encodeURIComponent(t)}&image=${encodeURIComponent(a)}`,d=n.imageReplacePending,l=n.imageReplaceError,u=n.imageReplaceSuccess===a;return`
      <div class="preview-header-actions">
        <a class="link-button" href="${o}" download>Download</a>
        <button class="link-button" type="button" data-radium-image-replace="${r(a)}" data-radium-image-replace-scene="${r(t)}" ${d?"disabled":""}>${d?"Replacing…":"Replace"}</button>
        <input id="radiumImageReplaceInput" type="file" accept=".png,image/png" hidden ${d?"disabled":""}>
        ${l?`<span class="error-text">${r(l)}</span>`:""}
        ${u?'<span class="success-text">Replaced successfully</span>':""}
      </div>
    `}if(!e)return"";const c=ie(e);if(M(e)&&c?.previewKind==="video"&&c.previewAssetPath){const o=n.videoReplacePending,d=n.videoReplaceError,l=n.videoReplaceAssetPath===c.previewAssetPath;return`
      <div class="preview-header-actions">
        <a class="link-button" href="${X(c.previewAssetPath)}" download>Download</a>
        <button class="link-button" type="button" data-video-replace="${r(c.previewAssetPath)}" ${o?"disabled":""}>${o?"Replacing…":"Replace"}</button>
        <input id="videoReplaceInput" type="file" accept=".mp4,.mov,.webm,video/*" hidden ${o?"disabled":""}>
        ${d?`<span class="error-text">${r(d)}</span>`:""}
        ${l?'<span class="success-text">Replaced successfully</span>':""}
      </div>
    `}return`
    <div class="preview-header-actions">
      <a class="link-button" href="${X(e.path)}" download>Download</a>
    </div>
  `}function Qt(){const e=_.value,t=Tn();_.innerHTML=['<option value="">All scene types</option>',...t.map(a=>`<option value="${r(a)}">${r(a)}</option>`)].join(""),t.includes(e)&&(_.value=e)}let en=(e,t)=>`<h2>${r(t)}</h2>`;function Ca(e){en=e}const Ne=document.getElementById("cropModalBackdrop"),le=document.getElementById("cropModalCanvas"),tn=document.getElementById("cropModalCanvasWrap"),Na=document.getElementById("cropModalInfo"),xa=document.getElementById("cropModalClose"),Ma=document.getElementById("cropModalCancel"),Ta=document.getElementById("cropModalConfirm"),m={sourceImage:null,targetWidth:0,targetHeight:0,scenePath:"",imageId:"",cropX:0,cropY:0,cropW:0,cropH:0,dragging:!1,dragStartX:0,dragStartY:0,displayScale:1};function Da(e,t,a,s,i){m.sourceImage=e,m.targetWidth=t,m.targetHeight=a,m.scenePath=s,m.imageId=i;const c=t/a,o=e.naturalWidth,d=e.naturalHeight;let l,u;o/d>c?(u=d,l=Math.round(u*c)):(l=o,u=Math.round(l/c)),m.cropX=Math.round((o-l)/2),m.cropY=Math.round((d-u)/2),m.cropW=l,m.cropH=u,Na.textContent=`Source: ${o}×${d}  →  Target: ${t}×${a}. Drag to reposition the crop area.`,Ne.hidden=!1,mt()}function Re(){Ne.hidden=!0,m.sourceImage=null}function mt(){const e=m.sourceImage;if(!e)return;const t=e.naturalWidth,a=e.naturalHeight,s=tn.getBoundingClientRect(),i=s.width-40,c=s.height-40,o=Math.min(1,i/t,c/a),d=Math.round(t*o),l=Math.round(a*o);le.width=d,le.height=l,m.displayScale=1/o;const u=le.getContext("2d");u.clearRect(0,0,d,l),u.drawImage(e,0,0,d,l),u.fillStyle="rgba(0, 0, 0, 0.55)";const p=m.cropX/m.displayScale,f=m.cropY/m.displayScale,v=m.cropW/m.displayScale,w=m.cropH/m.displayScale;u.fillRect(0,0,d,f),u.fillRect(0,f+w,d,l-f-w),u.fillRect(0,f,p,w),u.fillRect(p+v,f,d-p-v,w),u.strokeStyle="rgba(250, 204, 21, 0.8)",u.lineWidth=2,u.strokeRect(p,f,v,w);const g=8;u.fillStyle="rgba(250, 204, 21, 1)";for(const[b,P]of[[p,f],[p+v,f],[p,f+w],[p+v,f+w]])u.fillRect(b-g/2,P-g/2,g,g)}function Fa(e){const t=le.getBoundingClientRect();m.dragging=!0,m.dragStartX=e.clientX-t.left,m.dragStartY=e.clientY-t.top,m._origCropX=m.cropX,m._origCropY=m.cropY,e.preventDefault()}function Ka(e){if(!m.dragging)return;const t=le.getBoundingClientRect(),a=e.clientX-t.left,s=e.clientY-t.top,i=(a-m.dragStartX)*m.displayScale,c=(s-m.dragStartY)*m.displayScale,o=m.sourceImage,d=o.naturalWidth,l=o.naturalHeight;m.cropX=Y(Math.round(m._origCropX+i),0,d-m.cropW),m.cropY=Y(Math.round(m._origCropY+c),0,l-m.cropH),mt()}function Ha(){m.dragging=!1}function Va(e){e.preventDefault();const t=m.sourceImage;if(!t)return;const a=t.naturalWidth,s=t.naturalHeight,i=m.targetWidth/m.targetHeight,c=e.deltaY>0?-.05:.05;let o=m.cropW*(1+c),d=o/i;if(o>a&&(o=a,d=o/i),d>s&&(d=s,o=d*i),o<16||d<16)return;o=Math.round(o),d=Math.round(d);const l=m.cropX+m.cropW/2,u=m.cropY+m.cropH/2;m.cropW=o,m.cropH=d,m.cropX=Y(Math.round(l-o/2),0,a-o),m.cropY=Y(Math.round(u-d/2),0,s-d),mt()}function Ga(){return new Promise(e=>{const t=document.createElement("canvas");t.width=m.targetWidth,t.height=m.targetHeight,t.getContext("2d").drawImage(m.sourceImage,m.cropX,m.cropY,m.cropW,m.cropH,0,0,m.targetWidth,m.targetHeight),t.toBlob(s=>e(s),"image/png")})}function Ua(e){return new Promise((t,a)=>{const s=URL.createObjectURL(e),i=new Image;i.onload=()=>{t(i)},i.onerror=()=>{URL.revokeObjectURL(s),a(new Error("Failed to load image"))},i.src=s})}async function Ze(e,t,a){if(!(!e||!t||!a)){n.imageReplacePending=!0,n.imageReplaceError="",n.imageReplaceSuccess=null,k();try{const s=E.value.trim(),i=await fetch(`/api/radium-image-replace?path=${encodeURIComponent(s)}&scene=${encodeURIComponent(e)}&image=${encodeURIComponent(t)}`,{method:"POST",headers:{"Content-Type":a.type||"image/png"},body:a}),c=await i.json();if(!i.ok)throw new Error(c.error||"Image replace failed");delete n.radiumScenesByPath[e],n.imageReplaceSuccess=t,pt(e)}catch(s){n.imageReplaceError=s.message}finally{n.imageReplacePending=!1,k()}}}async function Wa(e,t,a){const i=n.radiumScenesByPath[t]?.assetTree?.images?.find(l=>l.id===a);if(!i){await Ze(t,a,e);return}const c=await Ua(e),o=i.width,d=i.height;c.naturalWidth===o&&c.naturalHeight===d?(URL.revokeObjectURL(c.src),await Ze(t,a,e)):Da(c,o,d,t,a)}function ja(){le.addEventListener("pointerdown",Fa),window.addEventListener("pointermove",Ka),window.addEventListener("pointerup",Ha),tn.addEventListener("wheel",Va,{passive:!1}),xa.addEventListener("click",Re),Ma.addEventListener("click",Re),Ne.addEventListener("click",e=>{e.target===Ne&&Re()}),Ta.addEventListener("click",async()=>{const e=await Ga(),{scenePath:t,imageId:a}=m;Re(),await Ze(t,a,e)})}function _a(){if(!ye)return;if(n.loading){ye.innerHTML='<p class="muted">Inspecting target...</p>';return}if(n.error){ye.innerHTML=`<div class="error-state"><strong>Inspect failed</strong><p>${r(n.error)}</p></div>`;return}if(!n.currentData){ye.innerHTML='<p class="muted">No target loaded.</p>';return}const{currentData:e}=n;ye.innerHTML=`
    <span class="micro-label">Current target</span>
    <div class="stack">
      <strong>${r(T(e.resolvedPath||e.targetPath))}</strong>
      <span class="muted">${r(e.containerKind||"unknown container")}</span>
      ${D([["Driver",`<code>${r(xt(e.sourceSupport?.driver))}</code>`],["Mode",`<code>${r(e.sourceSupport?.mode||"unknown")}</code>`],["Content",e.spike?.path?`<code>${r(T(e.spike.path))}</code>`:"n/a"],["Runtime",e.spike?.versionText?`<code>${r(e.spike.versionText)}</code>`:"n/a"]])}
    </div>
  `}function qa(e){if(!e)return"";const t=Tt(e),a=n.assetMetadataPendingPath===e.path,s=n.assetMetadataErrorPath===e.path&&n.assetMetadataError,i=n.assetMetadataSavedPath===e.path&&!a&&!s,c=s?n.assetMetadataError:i?"Saved alias and description.":"";return`
    <form class="asset-meta-form" data-asset-metadata-form data-metadata-asset-path="${r(e.path)}">
      <label class="field-label" for="assetAliasInput">Display name</label>
      <input
        id="assetAliasInput"
        name="alias"
        type="text"
        spellcheck="false"
        value="${r(t.alias)}"
        placeholder="${r(T(e.path))}"
        data-asset-alias-input
        ${a?"disabled":""}
      >
      <label class="field-label" for="assetDescriptionInput">Description</label>
      <textarea
        id="assetDescriptionInput"
        name="description"
        rows="4"
        spellcheck="false"
        data-asset-description-input
        ${a?"disabled":""}
      >${r(t.description)}</textarea>
      <p class="muted asset-meta-hint">Shown anywhere the file name appears. Leave both fields blank to fall back to the raw file name.</p>
      <div class="inline-actions">
        <button class="link-button" type="submit" ${a?"disabled":""}>${a?"Saving...":"Save metadata"}</button>
        <button class="link-button" type="button" data-clear-asset-metadata="${r(e.path)}" ${a?"disabled":""}>Clear metadata</button>
      </div>
      ${c?`<p class="asset-meta-feedback${s?" is-error":""}">${r(c)}</p>`:""}
    </form>
  `}function nn(e,t){const a=r(e?L(e):t);if(!e)return`<h2>${a}</h2>`;if(n.inlineAssetEditorPath===e.path){const i=Tt(e),c=n.assetMetadataPendingPath===e.path,o=i.alias||L(e);return`
      <form class="preview-title-edit-form" data-inline-asset-title-form data-inline-asset-path="${r(e.path)}">
        <input
          class="preview-title-input"
          type="text"
          spellcheck="false"
          value="${r(o)}"
          data-inline-asset-alias-input
          ${c?"disabled":""}
        >
        <button
        class="asset-edit-button"
        type="submit"
          aria-label="Save asset name"
          title="Save asset name"
          ${c?"disabled":""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M6.6 11.2 3.4 8l-1.1 1.1 4.3 4.3 7.1-7.1-1.1-1.1z" fill="currentColor"></path>
          </svg>
        </button>
        <button
          class="asset-edit-button"
          type="button"
          data-cancel-inline-asset-edit="${r(e.path)}"
          aria-label="Cancel asset name edit"
          title="Cancel"
          ${c?"disabled":""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m4.1 3 3.9 3.9L11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1z" fill="currentColor"></path>
          </svg>
        </button>
      </form>
    `}return`
    <div class="preview-title-row" data-edit-asset-metadata="${r(e.path)}" title="Double-click to edit name">
      <h2>
        <span class="preview-title-text">${a}</span>
        <button
          class="asset-edit-button asset-edit-button-inline"
          type="button"
          data-edit-asset-metadata="${r(e.path)}"
          aria-label="Edit asset name"
          title="Edit asset name"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M11.8 1.8a1.7 1.7 0 0 1 2.4 2.4l-7.9 7.9-3.6.8.8-3.6 7.9-7.9Zm1.4 1-1.4-1.4a.5.5 0 0 0-.7 0L10 2.5l2.1 2.1 1.1-1.1a.5.5 0 0 0 0-.7ZM11.3 5.3 9.2 3.2 4 8.4l-.5 2 2-.5 5.8-5.8Z" fill="currentColor"></path>
          </svg>
        </button>
      </h2>
    </div>
  `}Ca(nn);function an(e){e&&(n.sidebarInlineAssetEditorPath=null,n.inlineAssetEditorPath=e,n.assetMetadataDraftByPath[e]={alias:ke(e)||de(e),description:q(e)},S(),window.requestAnimationFrame(()=>{const t=j.querySelector("[data-inline-asset-alias-input]");t?.focus(),t?.select()}))}function sn(e=n.inlineAssetEditorPath){e&&(n.assetMetadataDraftByPath[e]={alias:ke(e),description:q(e)},n.inlineAssetEditorPath===e&&(n.inlineAssetEditorPath=null),S())}function Oa(e){if(!e)return;n.inlineAssetEditorPath=null,n.sidebarInlineAssetEditorPath=e;let t;e.startsWith(ne)?t=n.sceneNodeAliasByKey[e]||e.split("::").pop()||e:t=ke(e)||de(e)||Ht(e),n.assetMetadataDraftByPath[e]={alias:t,description:q(e)},S(),window.requestAnimationFrame(()=>{const a=N.querySelector("[data-sidebar-inline-asset-alias-input]");a?.focus(),a?.select()})}function rn(e=n.sidebarInlineAssetEditorPath){e&&(e.startsWith(ne)?n.assetMetadataDraftByPath[e]={alias:n.sceneNodeAliasByKey[e]||"",description:""}:n.assetMetadataDraftByPath[e]={alias:ke(e),description:q(e)},n.sidebarInlineAssetEditorPath===e&&(n.sidebarInlineAssetEditorPath=null),S())}function za(){if(n.error){we.innerHTML="";return}if(me()){const i=ge(),c=i?.counts||{};we.innerHTML=`
      <div class="section-head"><h2>Rule graph</h2></div>
      ${i?D([["Families",y(c.eventFamilies||0)],["Scenes",`${y(c.scenes||0)}${c.namedScenes?` (${y(c.namedScenes)} named)`:""}`],["Sounds",y(c.sounds||0)],["Modules",y(c.ruleModules||0)]]):'<p class="muted">Graph not loaded yet.</p>'}
      ${i?`
        <div class="inline-actions">
          <a class="link-button" href="/api/rule-graph?path=${encodeURIComponent(E.value.trim())}" target="_blank" rel="noreferrer">Open JSON</a>
        </div>
      `:""}
    `;return}if(F()){const i=ae(),c=at(),o=H(i),d=se(i);we.innerHTML=`
      <div class="section-head"><h2>Selection</h2></div>
      ${i?D([["Name",`<code>${r(o)}</code>`],["Script id",`<code>${r(d||`Script ${i.scriptIndex}`)}</code>`],["Channels",`<code>${r(et(i))}</code>`],["Duration",Pe(i.durationMs)],["Codec",`<code>${r(i.codec)}</code>`],["Fragments",y(i.fragmentCount)],["Frames",y(i.byteLength)]]):'<p class="muted">Select a sound script to inspect it.</p>'}
      ${i?Jt(i):""}
      ${c?D([["Sample rate",`${y(c.sampleRate)} Hz`],["Scripts",y(c.scriptCount)]]):""}
      ${n.soundActionError?`<p class="muted">${r(n.soundActionError)}</p>`:""}
    `;return}const e=U(),t=ie(e);if(!e){we.innerHTML=`
      <div class="section-head"><h2>Selection</h2></div>
      <p class="muted">Select an asset to inspect its format, offsets, and preview links.</p>
    `;return}const a=X(e.path),s=ot(e);we.innerHTML=`
    <div class="section-head"><h2>Selection</h2></div>
    ${D([["Name",`<code>${r(L(e))}</code>`],["Path",`<code>${r(e.path)}</code>`],["Description",r(xe(e)||"n/a")],["Kind",`<code>${r(e.kind)}</code>`],["Format",`<code>${r(e.format||"unknown")}</code>`],["Scene type",t?.sceneType?`<code>${r(t.sceneType)}</code>`:e.sceneType?`<code>${r(e.sceneType)}</code>`:"n/a"],["Size",y(e.size)],["Stored",y(e.storedSize)],["Offset",`<code>${ze(e.offset)}</code>`]])}
    <div class="inline-actions">
      <a class="link-button" href="${a}" target="_blank" rel="noreferrer">Open Raw</a>
      ${rt(e)?`<a class="link-button" href="${s}" target="_blank" rel="noreferrer">Open Preview</a>`:""}
    </div>
    ${qa(e)}
  `}function Xa(){if(!n.currentData||n.error){$t.innerHTML="";return}const e=n.currentData.squashfs;$t.innerHTML=`
    <div class="section-head"><h2>Input source</h2></div>
    ${D([["Driver",`<code>${r(xt(n.currentData.sourceSupport?.driver))}</code>`],["Status",`<code>${r(n.currentData.sourceSupport?.status||"unknown")}</code>`],["Mode",`<code>${r(n.currentData.sourceSupport?.mode||"unknown")}</code>`],["Wrapper",e?`<code>${r(T(e.innerRelative))}</code>`:"none"],["Extracted",e?`<code>${r(T(e.extractedPath))}</code>`:"n/a"]])}
    ${n.currentData.sourceSupport?.note?`<p class="muted">${r(n.currentData.sourceSupport.note)}</p>`:""}
  `}function Ya(){if(!n.currentData||n.error){Pt.innerHTML="";return}const e=n.currentData.spike?.assetManifest;Pt.innerHTML=`
    <div class="section-head"><h2>Manifest</h2></div>
    ${e?D([["Paths",y(e.totalPaths)],["Likely assets",y(e.likelyAssets.length)],["Game assets",y(e.gameAssets.length)],["Kinds",Object.keys(e.byKind||{}).length?Object.entries(e.byKind).map(([t,a])=>`${r(t)}:${y(a)}`).join("<br>"):"n/a"]]):'<p class="muted">No manifest-like path list was extracted.</p>'}
  `}function Ja(e){if(!e)return"";const t=e.previewKind==="video",a=n.videoReplacePending,s=n.videoReplaceError,i=n.videoReplaceAssetPath===e.path;return`
    <div class="preview-header-actions">
      <a class="link-button" href="${X(e.path)}" download>Download</a>
      ${t?`
        <button class="link-button" type="button" data-video-replace="${r(e.path)}" ${a?"disabled":""}>${a?"Replacing…":"Replace"}</button>
        <input id="videoReplaceInput" type="file" accept=".mp4,.mov,.webm,video/*" hidden ${a?"disabled":""}>
        ${s?`<span class="error-text">${r(s)}</span>`:""}
        ${i?'<span class="success-text">Replaced successfully</span>':""}
      `:""}
    </div>
  `}function Za(){const e=U();return`
    <div class="viewer-stack">
      <section class="preview-stage preview-stage-seamless">
        <div class="preview-header">
          <div class="preview-header-main">
            ${nn(e,"Select an asset")}
          </div>
          ${Ja(e)}
        </div>
        ${Zt(e)}
      </section>
    </div>
  `}function Qa(){n.currentData?.spike;const e=U();return at(),`
    <div class="viewer-stack">
      <section class="preview-stage">
        <div class="preview-header">
          <div class="preview-header-main">
            <h2>${r(T(n.currentData.resolvedPath||n.currentData.targetPath||"No target"))}</h2>
          </div>
        </div>
      </section>

      <section class="two-col">
        <article class="panel">
          <h3>Source summary</h3>
          ${D([["Requested path",`<code>${r(n.currentData.targetPath)}</code>`],["Resolved path",`<code>${r(n.currentData.resolvedPath)}</code>`],["Driver",`<code>${r(n.currentData.sourceSupport?.driver||"unknown")}</code>`],["Status",`<code>${r(n.currentData.sourceSupport?.status||"unknown")}</code>`],["Mode",`<code>${r(n.currentData.sourceSupport?.mode||"unknown")}</code>`]])}
        </article>
        <article class="panel">
          <h3>Current selection</h3>
          ${e?D([["Name",`<code>${r(L(e))}</code>`],["Path",`<code>${r(e.path)}</code>`],["Description",r(xe(e)||"n/a")],["Kind",`<code>${r(e.kind)}</code>`],["Preview",`<code>${r(e.previewKind||"none")}</code>`],["Size",y(e.size)],["Scene",e.scenePath?`<code>${r(e.scenePath)}</code>`:"n/a"]]):'<p class="muted">No asset selected yet.</p>'}
        </article>
      </section>
    </div>
  `}function es(){const e=n.currentData?.spike?.entries||[];return`
    <div class="viewer-stack">
      <section class="preview-stage">
        <div class="preview-header">
          <div>
            <h2>Indexed entry blocks</h2>
          </div>
        </div>
      </section>
      <section class="entry-grid">
        ${e.length?e.map((t,a)=>`
          <article class="entry-card">
            <div class="eyebrow">Entry ${a+1}</div>
            <h3>${r(t.name||t.indexType||"Unnamed entry")}</h3>
            ${D([["SPK0",`<code>${ze(t.spk0Offset)}</code>`],["Index",`<code>${ze(t.indexOffset)}</code>`],["Type",`<code>${r(t.indexType||"n/a")}</code>`],["Declared",y(t.declaredSize)],["Payload",`<code>${r(t.payloadKind||"unknown")}</code>`],["Strings",y(t.stringsCount)],["Files",y(t.indexedFiles.length)]])}
          </article>
        `).join(""):'<div class="panel"><p class="muted">No entry groups were found by the current parser.</p></div>'}
      </section>
    </div>
  `}function ts(){const e=n.currentData?.spike?.stringsPreview||[],t=n.currentData?.squashfs?.listingPreview||[],a=n.currentData?.spike?.assetManifest?.gameAssets?.length?n.currentData.spike.assetManifest.gameAssets:n.currentData?.spike?.assetManifest?.paths||[];return`
    <div class="viewer-stack">
      <section class="preview-stage">
        <div class="preview-header">
          <div>
            <h2>Strings, paths, and wrapper hints</h2>
          </div>
        </div>
      </section>

      <section class="reference-grid">
        <article class="panel">
          <h3>Top-level strings</h3>
          ${We(e)}
        </article>
        <article class="panel">
          <h3>Squashfs listing preview</h3>
          ${We(t)}
        </article>
      </section>

      <section class="panel">
        <h3>Manifest paths</h3>
        ${We(a,"manifest-paths")}
      </section>
    </div>
  `}function ns(){if(ee(),ft(),Ye(),n.loading){j.innerHTML='<div class="empty-state"><p class="muted">Inspecting target and rebuilding the workbench...</p></div>';return}if(n.error){j.innerHTML=`<div class="error-state"><strong>Inspect failed</strong><p>${r(n.error)}</p></div>`;return}if(!n.currentData){j.innerHTML='<div class="empty-state"><p class="muted">Load a target to populate the workbench.</p></div>';return}let e="";n.activeView==="graph"&&(e=Qn()),n.activeView==="summary"&&(e=Qa()),n.activeView==="assets"&&(e=F()?va():Za()),n.activeView==="scenes"&&(e=Aa()),n.activeView==="entries"&&(e=es()),n.activeView==="references"&&(e=ts());const t=sa();j.innerHTML=e,oa(t),na();const a=U(),s=ie(a);if(s?.previewKind==="flipbook"&&s.frames?.length>1){Ia(s);return}if(a?.sceneType==="StreamingFlipbook"&&a.clipFrames?.length>1){Pa(a);return}Ba()}function as(){if(me()){Zn();return}if(Z&&(F()?Z.textContent="Sound index":Z.textContent=n.activeView==="scenes"?"Scene index":"Asset index"),!n.currentData||n.error){N.innerHTML='<p class="muted">No assets to display.</p>';return}if(F()){jt();const t=Wt();if(!t.length){const a=n.currentData?.spike?.soundError;N.innerHTML=a?`<div class="error-state"><strong>Sound decode failed</strong><p>${r(a)}</p></div>`:'<p class="muted">No sound scripts matched the current filters.</p>';return}N.innerHTML=ga(t);return}if(n.activeView==="scenes"){O();const t=ct();if(Z&&(Z.textContent=Kn(t)?"File browser":"Scene index"),!t.length){N.innerHTML='<p class="muted">No scene files matched the current filters.</p>';return}N.innerHTML=La(t);return}O();const e=De();if(!e.length){N.innerHTML='<p class="muted">No assets matched the current filters.</p>';return}N.innerHTML=e.map(t=>`
    ${n.sidebarInlineAssetEditorPath===t.path?`
      <div class="asset-row${t.path===n.selectedAssetPath?" is-selected":""} is-editing">
        ${Ee(t.path,L(t),`<div class="asset-subtitle">${r(t.path)}</div>`)}
      </div>
    `:`
      <button class="asset-row${t.path===n.selectedAssetPath?" is-selected":""}" type="button" data-asset-path="${r(t.path)}" data-edit-sidebar-asset-path="${r(t.path)}">
        <div class="asset-row-top">
          <span class="asset-title">${r(L(t))}</span>
          <span class="badge kind-badge">${r(t.kind)}</span>
        </div>
        <div class="asset-subtitle">${r(t.path)}</div>
      </button>
    `}
  `).join("")}function ss(){const e=n.currentData?.spike?.assetFiles.length||0,t=n.currentData?.spike?.radiumScenes.length||0,a=n.currentData?.spike?.soundScripts?.length||0,s=U(),i=ae(),c=he();wn.innerHTML=[`<span>${r(T(n.currentData?.resolvedPath||n.currentData?.targetPath||"no-target"))}</span>`,'<span class="divider"></span>',`<span>${y(e)} assets</span>`,'<span class="divider"></span>',`<span>${y(t)} scenes</span>`,'<span class="divider"></span>',`<span>${y(a)} sounds</span>`,'<span class="divider"></span>',`<span>${r(n.activeView)}</span>`,'<span class="divider"></span>',`<span>${r(me()?c?.label||"no graph node selected":F()?i?.label||"no sound selected":s?s.path:"nothing selected")}</span>`].join("")}function is(){return n.activeView==="graph"?"graph":n.activeView==="assets"&&n.activeKind==="all"?"all-files":n.activeView==="scenes"?"scenes":n.activeView==="assets"&&n.activeKind==="font"?"fonts":n.activeView==="assets"&&n.activeKind==="image"?"images":n.activeView==="assets"&&n.activeKind==="audio"?"audio":n.activeView==="assets"&&n.activeKind==="video"?"videos":""}function rs(){const e=is();for(const t of document.querySelectorAll("[data-view]"))t.classList.toggle("is-active",t.dataset.view===e)}function os(){const e=K();bn.textContent=y(e.filter(t=>t.kind==="font").length),Sn.textContent=y(e.filter(t=>t.kind==="image").length),$n.textContent=y(n.currentData?.spike?.radiumScenes.length||0),Pn.textContent=y(Le().length),Et&&(Et.textContent=y(e.filter(t=>t.kind==="video").length)),Bt&&(Bt.textContent=y(ge()?.counts?.eventFamilies||0))}function cs(){if(n.loading){W.textContent="Inspecting target...";return}if(n.error){W.textContent="Inspect failed";return}if(!n.currentData){W.textContent="No target loaded";return}const e=U(),t=ae(),a=he();if(n.activeView==="graph"){W.textContent=a?.label||"Rule graph";return}if(n.activeView==="summary"){W.textContent=T(n.currentData.resolvedPath||n.currentData.targetPath);return}if(n.activeView==="scenes"){if(n.selectedSceneNodeId&&n.selectedSceneNodeScenePath){const s=dt(n.selectedSceneNodeScenePath,n.selectedSceneNodeId),i=n.radiumScenesByPath[n.selectedSceneNodeScenePath],o=(i?.assetTree?[...i.assetTree.images||[],...i.assetTree.sounds||[],...i.assetTree.videoClips||[],...i.assetTree.fonts||[],...i.assetTree.spineAssets||[],...i.assetTree.texts||[]]:[]).find(d=>d.id===n.selectedSceneNodeId);W.textContent=s||o?.label||n.selectedSceneNodeId}else W.textContent=e?L(e):"Radium scenes";return}if(F()){W.textContent=t?.label||"Decoded sound scripts";return}W.textContent=e?L(e):"No asset selected"}function ds(){const e=!!n.currentData;if(St&&(St.hidden=e||n.loading),Ge)if(e){const t=T(n.currentData.resolvedPath||n.currentData.targetPath||"");Ge.textContent=`Current File: ${t}`}else Ge.textContent="No file loaded"}function ls(){const e=me(),t=F()||e;It&&(It.hidden=n.activeView==="scenes"),yt&&(yt.textContent=e?"Graph search":"Asset search"),te.placeholder=e?"rampage, scene.radium, demand_loaded":"png, radium, scene.assets",wt&&(wt.hidden=e),bt&&(bt.hidden=t),_&&(_.hidden=t)}function S(){me()&&(lt(),n.currentData&&!n.ruleGraph&&!n.ruleGraphLoading&&!n.ruleGraphError&&qt()),_a(),as(),za(),Xa(),Ya(),ns(),ss(),rs(),ls(),os(),cs(),ds(),ba(),la(),ta()}Ln(S);kn(Je);async function Se(e,t){if(e){n.assetMetadataPendingPath=e,n.assetMetadataSavedPath=null,n.assetMetadataErrorPath=null,n.assetMetadataError="",S();try{const a=await fetch("/api/asset-metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({assetPath:e,alias:t.alias,description:t.description})}),s=await a.json();if(!a.ok)throw new Error(s.error||"Asset metadata save failed");if(Vn(e,s.metadata),e.startsWith(ne)){const i=String(s.metadata?.alias||"");i?n.sceneNodeAliasByKey[e]=i:delete n.sceneNodeAliasByKey[e]}n.assetMetadataDraftByPath[e]={alias:String(s.metadata?.alias||""),description:String(s.metadata?.description||"")},n.assetMetadataSavedPath=e,n.inlineAssetEditorPath===e&&(n.inlineAssetEditorPath=null),n.sidebarInlineAssetEditorPath===e&&(n.sidebarInlineAssetEditorPath=null)}catch(a){n.assetMetadataErrorPath=e,n.assetMetadataError=a.message}finally{n.assetMetadataPendingPath===e&&(n.assetMetadataPendingPath=null),S()}}}async function us(e){const t=document.querySelector("[data-video-replace]")?.dataset.videoReplace;if(t){n.videoReplacePending=!0,n.videoReplaceError="",n.videoReplaceAssetPath=null,S();try{const a=E.value.trim(),s=await fetch(`/api/video-replace?path=${encodeURIComponent(a)}&asset=${encodeURIComponent(t)}`,{method:"POST",body:e}),i=await s.json();if(!s.ok)throw new Error(i.error||"Video replace failed");n.videoReplaceAssetPath=t,await fe(a,{preserveSelection:!0})}catch(a){n.videoReplaceError=a.message}finally{n.videoReplacePending=!1,S()}}}async function fe(e,{preserveSelection:t=!1}={}){Bn(),Ke();const a=t?n.selectedAssetPath:null,s=t?n.selectedSoundScriptIndex:null;He({clearSource:!0}),n.loading=!0,n.error="",n.ruleGraph=null,n.ruleGraphLoading=!1,n.ruleGraphError="",n.selectedGraphNodeId=null,n.expandedGraphFamilies={},n.graphSceneNameByPath={},n.soundActionError="",n.assetMetadataDraftByPath={},n.assetMetadataPendingPath=null,n.assetMetadataSavedPath=null,n.assetMetadataErrorPath=null,n.assetMetadataError="",n.inlineAssetEditorPath=null,n.sidebarInlineAssetEditorPath=null,n.sceneDetailsByPath={},n.sceneLoadingByPath={},n.radiumScenesByPath={},n.radiumSceneLoadingByPath={},n.expandedScenePaths={},n.selectedSceneNodeId=null,n.selectedSceneNodeScenePath=null,n.sceneNodeAliasByKey={},ft(),Gn(),S();try{const i=await fetch(`/api/inspect?path=${encodeURIComponent(e)}`),c=await i.json();if(!i.ok)throw new Error(c.error||"Inspect failed");n.currentData=c;try{localStorage.setItem(pn,e)}catch{}a&&c.spike?.assetFiles?.some(o=>o.path===a)&&(n.selectedAssetPath=a),s!==null&&c.spike?.soundScripts?.some(o=>o.scriptIndex===s)&&(n.selectedSoundScriptIndex=s),Qt(),O(),jt(),Hn()}catch(i){n.currentData=null,n.selectedAssetPath=null,n.selectedSoundScriptIndex=null,n.error=i.message}finally{n.loading=!1,S()}}const gt=!window.electronAPI&&typeof window.__pinballWebFileInput<"u";async function on(){if(gt){const t=document.getElementById("webFileInput");t&&t.click();return}let e;window.electronAPI?.pickFile?e=await window.electronAPI.pickFile():e=(await(await fetch("/api/pick-file")).json()).path,e&&(E.value=e,await fe(e))}vn.addEventListener("click",()=>{on()});yn.addEventListener("click",()=>{on()});document.body.addEventListener("dragover",e=>{e.preventDefault(),e.stopPropagation(),document.body.classList.add("drag-over")});document.body.addEventListener("dragleave",e=>{e.preventDefault(),e.stopPropagation(),document.body.classList.remove("drag-over")});document.body.addEventListener("drop",async e=>{e.preventDefault(),e.stopPropagation(),document.body.classList.remove("drag-over");const t=e.dataTransfer?.files?.[0];if(!t)return;if(gt){window.__pinballWebSetFile?.(t),E.value=t.name,await fe(t.name);return}const a=t.path;a&&(E.value=a,await fe(a))});const cn=document.getElementById("inspectorToggle"),dn=document.querySelector(".workspace"),ln="pinball-explorer.inspector-hidden";function un(e){dn.classList.toggle("inspector-hidden",e),cn.classList.toggle("is-active",!e)}un(localStorage.getItem(ln)!=="false");cn.addEventListener("click",()=>{const e=!dn.classList.contains("inspector-hidden");un(e),localStorage.setItem(ln,e?"true":"false")});function ps(){if(!x)return;let e=null;const t=i=>{const c=document.querySelector(".workspace")?.getBoundingClientRect();if(!c)return;const o=Y(i-c.left,oe,ce);Oe(o)},a=()=>{if(e!==null){Lt(s()),x.classList.remove("is-dragging");try{x.releasePointerCapture(e)}catch{}e=null,document.body.style.cursor=""}},s=()=>{const i=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"));return Number.isFinite(i)?Y(i,oe,ce):240};x.addEventListener("pointerdown",i=>{window.matchMedia("(max-width: 1180px)").matches||(e=i.pointerId,x.setPointerCapture(i.pointerId),x.classList.add("is-dragging"),document.body.style.cursor="col-resize",t(i.clientX),i.preventDefault())}),x.addEventListener("pointermove",i=>{i.pointerId===e&&t(i.clientX)}),x.addEventListener("pointerup",i=>{i.pointerId===e&&a()}),x.addEventListener("pointercancel",i=>{i.pointerId===e&&a()}),window.addEventListener("keydown",i=>{if(document.activeElement!==x||!["ArrowLeft","ArrowRight","Home","End"].includes(i.key))return;const c=s();let o=c;i.key==="ArrowLeft"&&(o=c-12),i.key==="ArrowRight"&&(o=c+12),i.key==="Home"&&(o=oe),i.key==="End"&&(o=ce),o=Oe(o),Lt(o),i.preventDefault()})}document.addEventListener("click",e=>{const t=e.target.closest("[data-view]");if(t){const h=t.dataset.view;h==="all-files"?(n.activeView="assets",n.activeKind="all"):h==="fonts"?(n.activeView="assets",n.activeKind="font"):h==="images"?(n.activeView="assets",n.activeKind="image"):h==="audio"?(n.activeView="assets",n.activeKind="audio"):h==="videos"?(n.activeView="assets",n.activeKind="video"):h==="scenes"?(n.activeView="scenes",n.activeKind="all"):h==="graph"?(n.activeView="graph",n.activeKind="all"):(n.activeView="assets",n.activeKind="all"),n.activeView==="graph"&&qt(),S();return}const a=e.target.closest("[data-sound-play]");if(a){ua(Number(a.dataset.soundPlay));return}const s=e.target.closest("[data-sound-stop]");if(s){pa(Number(s.dataset.soundStop));return}const i=e.target.closest("[data-sound-script]");if(i){Ke(),n.selectedSoundScriptIndex=Number(i.dataset.soundScript),pe(),qe();return}if(e.target.closest("[data-sound-replace]")){if(n.soundActionPending)return;document.getElementById("soundReplaceInput")?.click();return}const o=e.target.closest("[data-scene-node-rename-start]");if(o){const h=o.dataset.sceneNodeRenameStart;n.inlineAssetEditorPath=h;const ve=n.sceneNodeAliasByKey[h]||"",fn=h.split("::").pop()||h;n.assetMetadataDraftByPath[h]={alias:ve||fn,description:""},S(),window.requestAnimationFrame(()=>{const ht=j.querySelector("[data-scene-node-rename-input]");ht?.focus(),ht?.select()});return}const d=e.target.closest("[data-scene-node-rename-cancel]");if(d){const h=d.dataset.sceneNodeRenameCancel;n.assetMetadataDraftByPath[h]={alias:n.sceneNodeAliasByKey[h]||"",description:""},n.inlineAssetEditorPath===h&&(n.inlineAssetEditorPath=null),S();return}if(e.target.closest("[data-video-replace]")){if(n.videoReplacePending)return;document.getElementById("videoReplaceInput")?.click();return}if(e.target.closest("[data-radium-image-replace]")){if(n.imageReplacePending)return;document.getElementById("radiumImageReplaceInput")?.click();return}const p=e.target.closest("[data-clear-asset-metadata]");if(p){Se(p.dataset.clearAssetMetadata,{alias:"",description:""});return}const f=e.target.closest("[data-cancel-inline-asset-edit]");if(f){sn(f.dataset.cancelInlineAssetEdit);return}const v=e.target.closest("[data-cancel-sidebar-inline-asset-edit]");if(v){rn(v.dataset.cancelSidebarInlineAssetEdit);return}if(e.target.closest("[data-inline-asset-title-form]")||e.target.closest("[data-sidebar-inline-asset-title-form]")||e.target.closest("[data-asset-metadata-form]"))return;const w=e.target.closest("[data-asset-path]");if(w){n.selectedAssetPath=w.dataset.assetPath,n.activeView="assets",S();return}const g=e.target.closest("[data-scene-tree-toggle]");if(g){const h=g.dataset.sceneTreeToggle;n.expandedScenePaths[h]?delete n.expandedScenePaths[h]:(n.expandedScenePaths[h]=!0,!n.radiumScenesByPath[h]&&!n.radiumSceneLoadingByPath?.[h]&&pt(h)),S();return}const b=e.target.closest("[data-scene-tree-node]");if(b){n.selectedSceneNodeId=b.dataset.sceneTreeNode,n.selectedSceneNodeScenePath=b.dataset.sceneTreeNodeScene,S();return}if(e.target.closest("[data-back-to-scene]")){n.selectedSceneNodeId=null,n.selectedSceneNodeScenePath=null,S();return}const B=e.target.closest("[data-scene-asset]");if(B){n.selectedAssetPath=B.dataset.sceneAsset,n.selectedSceneNodeId=null,n.selectedSceneNodeScenePath=null,S();return}const R=e.target.closest("[data-graph-family-toggle]");if(R){const h=R.dataset.graphFamilyToggle;n.expandedGraphFamilies[h]?delete n.expandedGraphFamilies[h]:n.expandedGraphFamilies[h]=!0,S();return}const C=e.target.closest("[data-graph-scroll-to-family]");if(C){const h=C.dataset.graphScrollToFamily;n.expandedGraphFamilies[h]=!0,S(),window.requestAnimationFrame(()=>{document.getElementById(`graph-family-${h}`)?.scrollIntoView({behavior:"smooth",block:"start"})});return}const I=e.target.closest("[data-graph-node-id]");if(I){n.selectedGraphNodeId=I.dataset.graphNodeId,S();return}const z=e.target.closest("[data-graph-open-scene]");if(z){const h=he(z.dataset.graphOpenScene),ve=jn(h);ve&&(n.selectedAssetPath=ve,n.activeView="scenes",n.activeKind="all",S());return}const re=e.target.closest("[data-graph-open-audio]");re&&(n.selectedSoundScriptIndex=Number(re.dataset.graphOpenAudio),n.activeView="assets",n.activeKind="audio",pe(),qe())});document.addEventListener("dblclick",e=>{const t=e.target.closest(".preview-title-row[data-edit-asset-metadata]");if(t){an(t.dataset.editAssetMetadata);return}const a=e.target.closest("[data-edit-sidebar-asset-path]");a&&Oa(a.dataset.editSidebarAssetPath)});document.addEventListener("click",e=>{const t=e.target.closest("[data-edit-asset-metadata].asset-edit-button");t&&an(t.dataset.editAssetMetadata)});document.addEventListener("change",async e=>{if(e.target.matches("[data-scene-viewable-only]")){Be.checked=e.target.checked,O(),S();return}if(e.target.matches("[data-scene-type-filter]")){_.value=e.target.value,O(),S();return}if(e.target.id==="videoReplaceInput"){const[a]=e.target.files||[];if(e.target.value="",!a)return;await us(a);return}if(e.target.id==="radiumImageReplaceInput"){const[a]=e.target.files||[];if(e.target.value="",!a)return;const s=n.selectedSceneNodeScenePath,i=n.selectedSceneNodeId;await Wa(a,s,i);return}if(e.target.id!=="soundReplaceInput")return;const[t]=e.target.files||[];e.target.value="",t&&await fa(t)});document.addEventListener("submit",async e=>{const t=e.target.closest("[data-scene-node-rename-form]");if(t){e.preventDefault();const o=t.dataset.sceneNodeRenamePath||"",d=t.querySelector("[data-scene-node-rename-input]")?.value||"",l=o.split("::").pop()||"",u=d.trim()===l?"":d.trim();await Se(o,{alias:u,description:""});return}const a=e.target.closest("[data-inline-asset-title-form]");if(a){e.preventDefault();const o=a.dataset.inlineAssetPath||"";await Se(o,{alias:Ue(o,a.querySelector("[data-inline-asset-alias-input]")?.value||"",de(o)),description:q(o)});return}const s=e.target.closest("[data-sidebar-inline-asset-title-form]");if(s){e.preventDefault();const o=s.dataset.sidebarInlineAssetPath||"";await Se(o,{alias:Ue(o,s.querySelector("[data-sidebar-inline-asset-alias-input]")?.value||"",de(o)),description:q(o)});return}const i=e.target.closest("[data-asset-metadata-form]");if(!i)return;e.preventDefault();const c=i.dataset.metadataAssetPath||"";await Se(c,{alias:Ue(c,i.querySelector("[data-asset-alias-input]")?.value||"",de(c)),description:i.querySelector("[data-asset-description-input]")?.value||""})});document.addEventListener("input",e=>{if(e.target.matches("[data-scene-node-rename-input]")){const a=e.target.closest("[data-scene-node-rename-form]")?.dataset.sceneNodeRenamePath;if(!a)return;n.assetMetadataDraftByPath[a]={alias:e.target.value,description:""};return}if(e.target.matches("[data-inline-asset-alias-input]")){const a=e.target.closest("[data-inline-asset-title-form]")?.dataset.inlineAssetPath;if(!a)return;n.assetMetadataDraftByPath[a]={alias:e.target.value,description:q(a)};return}if(e.target.matches("[data-sidebar-inline-asset-alias-input]")){const a=e.target.closest("[data-sidebar-inline-asset-title-form]")?.dataset.sidebarInlineAssetPath;if(!a)return;n.assetMetadataDraftByPath[a]={alias:e.target.value,description:q(a)};return}if(e.target.matches("[data-asset-alias-input], [data-asset-description-input]")){const t=e.target.closest("[data-asset-metadata-form]"),a=t?.dataset.metadataAssetPath;if(!a)return;n.assetMetadataDraftByPath[a]={alias:t.querySelector("[data-asset-alias-input]")?.value||"",description:t.querySelector("[data-asset-description-input]")?.value||""};return}e.target.matches("[data-scene-search]")&&(te.value=e.target.value,O(),S())});document.addEventListener("keydown",e=>{if(e.target.matches("[data-scene-node-rename-input]")){const s=e.target.closest("[data-scene-node-rename-form]"),i=s?.dataset.sceneNodeRenamePath;if(!i)return;if(e.key==="Enter"){e.preventDefault(),s.requestSubmit();return}e.key==="Escape"&&(e.preventDefault(),n.assetMetadataDraftByPath[i]={alias:n.sceneNodeAliasByKey[i]||"",description:""},n.inlineAssetEditorPath===i&&(n.inlineAssetEditorPath=null),S());return}if(e.target.matches("[data-inline-asset-alias-input]")){const s=e.target.closest("[data-inline-asset-title-form]"),i=s?.dataset.inlineAssetPath;if(!i)return;if(e.key==="Enter"){e.preventDefault(),s.requestSubmit();return}e.key==="Escape"&&(e.preventDefault(),sn(i));return}if(!e.target.matches("[data-sidebar-inline-asset-alias-input]"))return;const t=e.target.closest("[data-sidebar-inline-asset-title-form]"),a=t?.dataset.sidebarInlineAssetPath;if(a){if(e.key==="Enter"){e.preventDefault(),t.requestSubmit();return}e.key==="Escape"&&(e.preventDefault(),rn(a))}});te.addEventListener("input",()=>{me()?lt():O(),S()});Be.addEventListener("change",()=>{O(),S()});_.addEventListener("change",()=>{O(),S()});const pn="pinball-explorer.last-target";async function fs(){if(ya(),ja(),Oe(An()),ps(),gt){const a=document.getElementById("webFileInput");a&&a.addEventListener("change",async()=>{const s=a.files?.[0];s&&(window.__pinballWebSetFile?.(s),E.value=s.name,await fe(s.name))}),S();return}const t=await(await fetch("/api/default-target")).json();if(E.value=t.defaultTarget||localStorage.getItem(pn)||"",E.value){await fe(E.value);return}S()}fs();
