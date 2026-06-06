'use strict';

function slugify(str) {
  return (str || '')
    .toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || `ebook-${Date.now()}`;
}

// 單頁直式比例（A4），用於 oEmbed 卡片長寬比
const OE_W = 840, OE_H = 1188;

// 產生 oEmbed JSON，讓 Miro/Iframely 依書本長寬比做卡片
function oembedJSON(baseUrl, firstImage) {
  return JSON.stringify({
    version: '1.0',
    type: 'rich',
    provider_name: '電子書翻閱器',
    provider_url: baseUrl + '/',
    title: '電子書翻閱器',
    width: OE_W,
    height: OE_H,
    thumbnail_url: baseUrl + '/' + firstImage,
    html: '<iframe src="' + baseUrl + '/" width="' + OE_W + '" height="' + OE_H +
          '" style="border:0;" frameborder="0" allowfullscreen scrolling="no"></iframe>',
  }, null, 2);
}

function flipbookHTML(images, baseUrl) {
  const list = JSON.stringify(images);
  const first = images[0] || '';
  const meta = baseUrl ? `
  <link rel="canonical" href="${baseUrl}/">
  <meta property="og:type" content="rich">
  <meta property="og:site_name" content="電子書翻閱器">
  <meta property="og:title" content="電子書翻閱器">
  <meta property="og:url" content="${baseUrl}/">
  <meta property="og:image" content="${baseUrl}/${first}">
  <meta name="twitter:card" content="player">
  <meta name="twitter:title" content="電子書翻閱器">
  <meta name="twitter:image" content="${baseUrl}/${first}">
  <meta name="twitter:player" content="${baseUrl}/">
  <meta name="twitter:player:width" content="${OE_W}">
  <meta name="twitter:player:height" content="${OE_H}">
  <link rel="alternate" type="application/json+oembed" href="${baseUrl}/oembed.json" title="電子書翻閱器">` : '';
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>電子書翻閱器</title>${meta}
  <script src="https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js"><\/script>
  <style>
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden;background:transparent;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;color:#333}
    #app{position:relative;z-index:1;width:100%;height:100%;
      display:flex;flex-direction:column;align-items:center;justify-content:center}
    #stage{position:relative;flex:1;width:100%;
      display:flex;align-items:center;justify-content:center;overflow:hidden}
    #zoom-layer{display:flex;align-items:center;justify-content:center;
      transform-origin:center center;transition:transform .25s ease;will-change:transform}
    #book-shadow{transition:transform .45s cubic-bezier(.22,1,.36,1);
      filter:drop-shadow(0 12px 40px rgba(0,0,0,.25)) drop-shadow(0 4px 12px rgba(0,0,0,.15))}
    .page{overflow:hidden;user-select:none;-webkit-user-select:none;background:#fff}
    .page img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}
    .nav-btn{position:absolute;top:50%;transform:translateY(-50%);width:48px;height:48px;
      border-radius:50%;border:1.5px solid rgba(0,0,0,.15);background:rgba(255,255,255,.85);
      backdrop-filter:blur(12px);color:rgba(0,0,0,.55);font-size:22px;line-height:1;
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:all .2s ease;z-index:50;box-shadow:0 2px 8px rgba(0,0,0,.12)}
    .nav-btn:hover:not(:disabled){background:#fff;border-color:rgba(0,0,0,.25);transform:translateY(-50%) scale(1.1)}
    .nav-btn:active:not(:disabled){transform:translateY(-50%) scale(.93)}
    .nav-btn:disabled{opacity:.2;cursor:default}
    #prev-btn{left:14px}#next-btn{right:14px}
    #tools{position:absolute;top:12px;right:14px;display:flex;gap:8px;z-index:60}
    .tool-btn{width:40px;height:40px;border-radius:10px;border:1px solid rgba(0,0,0,.12);
      background:rgba(255,255,255,.9);backdrop-filter:blur(8px);color:rgba(0,0,0,.6);
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,.1);transition:all .15s ease}
    .tool-btn:hover{background:#fff;color:#222}
    .tool-btn.active{background:#333;color:#fff;border-color:#333}
    #bottom-bar{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);
      display:flex;align-items:center;justify-content:center;z-index:55}
    #page-indicator{font-size:12px;letter-spacing:.6px;color:rgba(0,0,0,.4);
      background:rgba(255,255,255,.7);backdrop-filter:blur(6px);padding:4px 16px;border-radius:20px}
    #loading{position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:12px;z-index:200;background:transparent}
    #loading.hidden{display:none}
    .spinner{width:36px;height:36px;border:3px solid rgba(0,0,0,.1);
      border-top-color:rgba(0,0,0,.4);border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    #loading p{font-size:13px;color:rgba(0,0,0,.4)}
  </style>
</head>
<body>
<div id="app">
  <div id="loading"><div class="spinner"></div><p>載入中…</p></div>
  <div id="stage">
    <button class="nav-btn" id="prev-btn">&#8592;</button>
    <div id="zoom-layer"><div id="book-shadow"><div id="book"></div></div></div>
    <button class="nav-btn" id="next-btn">&#8594;</button>
    <div id="tools">
      <button class="tool-btn" id="zoom-btn" title="放大／縮小">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      </button>
      <button class="tool-btn" id="full-btn" title="全螢幕">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
      </button>
    </div>
  </div>
  <div id="bottom-bar"><span id="page-indicator">第 1 / - 頁</span></div>
</div>
<script>
// 單頁呈現（true＝一次一頁、填滿卡片，像 heyzine）
const SINGLE_PAGE=true;
const CONFIG={images:${list},pageWidth:595,pageHeight:842,flipDuration:700};
let pf=null,totalPages=CONFIG.images.length,pageHalf=0;
let zoom=1,panX=0,panY=0,dragging=false,lastX=0,lastY=0;
function computeSize(){
  const s=document.getElementById('stage');
  const pad=6,aW=s.clientWidth-pad*2,aH=s.clientHeight-pad*2;
  const r=CONFIG.pageWidth/CONFIG.pageHeight,spread=SINGLE_PAGE?1:2;
  let h=aH,w=h*r*spread;if(w>aW){w=aW;h=w/(r*spread);}
  return{pageW:Math.floor(w/spread),pageH:Math.floor(h)};
}
function updateUI(){
  if(!pf)return;
  const c=pf.getCurrentPageIndex();
  document.getElementById('prev-btn').disabled=c<=0;
  document.getElementById('next-btn').disabled=c>=totalPages-1;
  document.getElementById('page-indicator').textContent=\`第 \${c+1} / \${totalPages} 頁\`;
}
// 雙頁模式下封面/封底單頁時平移置中；單頁模式不需要
function recenter(){
  if(!pf)return;
  if(SINGLE_PAGE){document.getElementById('book-shadow').style.transform='none';return;}
  const i=pf.getCurrentPageIndex(),n=totalPages;
  let shift=0;
  if(i===0)shift=-pageHalf;
  else if(i===n-1&&(n-1)%2===1)shift=pageHalf;
  document.getElementById('book-shadow').style.transform='translateX('+shift+'px)';
}
function applyZoom(){
  const zl=document.getElementById('zoom-layer');
  zl.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')';
  zl.style.cursor=zoom>1?(dragging?'grabbing':'grab'):'default';
  document.getElementById('book').style.pointerEvents=zoom>1?'none':'auto';
  document.getElementById('zoom-btn').classList.toggle('active',zoom>1);
}
function toggleZoom(){if(zoom>1){zoom=1;panX=0;panY=0;}else{zoom=2;}applyZoom();}
function toggleFull(){
  const el=document.getElementById('app');
  try{
    if(document.fullscreenElement||document.webkitFullscreenElement){(document.exitFullscreen||document.webkitExitFullscreen).call(document);}
    else{(el.requestFullscreen||el.webkitRequestFullscreen).call(el);}
  }catch(e){}
}
function hideLoading(){document.getElementById('loading').classList.add('hidden');}
function buildPages(){
  const book=document.getElementById('book');
  book.innerHTML='';
  CONFIG.images.forEach(function(src,i){
    const d=document.createElement('div');
    d.className='page';
    if(i===0)d.setAttribute('data-density','hard');
    const img=document.createElement('img');img.src=src;d.appendChild(img);
    book.appendChild(d);
  });
}
function init(){
  const{pageW,pageH}=computeSize();
  pageHalf=pageW/2;zoom=1;panX=0;panY=0;
  buildPages();
  pf=new St.PageFlip(document.getElementById('book'),{
    width:pageW,height:pageH,size:'fixed',drawShadow:true,
    flippingTime:CONFIG.flipDuration,usePortrait:SINGLE_PAGE,showCover:true,
    mobileScrollSupport:false,swipeDistance:25,clickEventForward:false,
    startPage:0,maxShadowOpacity:0.6
  });
  pf.on('init',()=>{hideLoading();recenter();});
  pf.loadFromHTML(document.getElementById('book').querySelectorAll('.page'));
  setTimeout(hideLoading,2000);
  pf.on('flip',()=>{updateUI();recenter();});
  pf.on('changeState',updateUI);
  updateUI();recenter();applyZoom();
  document.getElementById('prev-btn').addEventListener('click',()=>pf.flipPrev('bottom'));
  document.getElementById('next-btn').addEventListener('click',()=>pf.flipNext('bottom'));
  document.getElementById('zoom-btn').addEventListener('click',toggleZoom);
  document.getElementById('full-btn').addEventListener('click',toggleFull);
  const zl=document.getElementById('zoom-layer');
  zl.addEventListener('pointerdown',e=>{if(zoom<=1)return;dragging=true;lastX=e.clientX;lastY=e.clientY;zl.style.transition='none';zl.setPointerCapture(e.pointerId);applyZoom();});
  zl.addEventListener('pointermove',e=>{if(!dragging)return;panX+=e.clientX-lastX;panY+=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;applyZoom();});
  zl.addEventListener('pointerup',()=>{if(!dragging)return;dragging=false;zl.style.transition='transform .25s ease';applyZoom();});
  document.addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key))pf.flipPrev('bottom');
    if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();pf.flipNext('bottom');}
  });
}
let _rt;
window.addEventListener('resize',()=>{clearTimeout(_rt);_rt=setTimeout(()=>{if(!pf)return;pf.destroy();pf=null;document.getElementById('book').innerHTML='';init();},300);});
requestAnimationFrame(()=>requestAnimationFrame(init));
<\/script>
</body>
</html>`;
}

module.exports = { slugify, flipbookHTML, oembedJSON };
