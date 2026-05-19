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

function flipbookHTML(images) {
  const list = JSON.stringify(images);
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>電子書翻閱器</title>
  <script src="https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js"><\/script>
  <style>
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden;background:#f0ece6;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;color:#333}
    #app{position:relative;z-index:1;width:100%;height:100%;
      display:flex;flex-direction:column;align-items:center;justify-content:center}
    #stage{position:relative;flex:1;width:100%;
      display:flex;align-items:center;justify-content:center;overflow:hidden}
    #book-shadow{filter:drop-shadow(0 12px 40px rgba(0,0,0,.25)) drop-shadow(0 4px 12px rgba(0,0,0,.15))}
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
    #bottom-bar{flex-shrink:0;padding:10px 0 12px;display:flex;align-items:center;justify-content:center;z-index:10}
    #page-indicator{font-size:12px;letter-spacing:.6px;color:rgba(0,0,0,.4);
      background:rgba(0,0,0,.06);padding:4px 16px;border-radius:20px}
    #loading{position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:12px;z-index:200;background:#f0ece6}
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
    <div id="book-shadow"><div id="book"></div></div>
    <button class="nav-btn" id="next-btn">&#8594;</button>
  </div>
  <div id="bottom-bar"><span id="page-indicator">第 1 / - 頁</span></div>
</div>
<script>
const CONFIG={images:${list},pageWidth:595,pageHeight:842,flipDuration:700};
let pf=null,totalPages=CONFIG.images.length;
function computeSize(){
  const s=document.getElementById('stage');
  const aW=s.clientWidth-16,aH=s.clientHeight-44-16;
  const r=CONFIG.pageWidth/CONFIG.pageHeight;
  let h=aH,w=h*r*2;if(w>aW){w=aW;h=w/(r*2);}
  return{pageW:Math.floor(w/2),pageH:Math.floor(h)};
}
function updateUI(){
  if(!pf)return;
  const c=pf.getCurrentPageIndex();
  document.getElementById('prev-btn').disabled=c<=0;
  document.getElementById('next-btn').disabled=c>=totalPages-1;
  document.getElementById('page-indicator').textContent=\`第 \${c+1} / \${totalPages} 頁\`;
}
function hideLoading(){document.getElementById('loading').classList.add('hidden');}
function init(){
  const{pageW,pageH}=computeSize();
  pf=new St.PageFlip(document.getElementById('book'),{
    width:pageW,height:pageH,size:'fixed',drawShadow:true,
    flippingTime:CONFIG.flipDuration,usePortrait:false,showCover:true,
    mobileScrollSupport:false,swipeDistance:25,clickEventForward:false,
    startPage:0,maxShadowOpacity:0.6
  });
  pf.on('init',()=>hideLoading());
  pf.loadFromImages(CONFIG.images);
  setTimeout(hideLoading,2000);
  pf.on('flip',updateUI);pf.on('changeState',updateUI);updateUI();
  document.getElementById('prev-btn').addEventListener('click',()=>pf.flipPrev('bottom'));
  document.getElementById('next-btn').addEventListener('click',()=>pf.flipNext('bottom'));
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

module.exports = { slugify, flipbookHTML };
