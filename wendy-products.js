/* Wendy: show confirmed products from the database.
 *
 * Products only appear here when their row in Supabase has spec.published = true.
 * If the database cannot be reached, or nothing is published, the app keeps
 * showing the built-in screens exactly as before.
 *
 * What this does:
 *  - replaces the Prams list (and the search / swap sheet) with the published products
 *  - builds each product page from the database row, hiding anything that is empty
 *  - sends the Rent now / Buy now buttons to the saved links
 */
(function () {
  "use strict";
  if (typeof screens === "undefined" || typeof CATALOG === "undefined" ||
      typeof SUPA_URL === "undefined" || typeof SUPA_KEY === "undefined") return;

  var TPL={"H": "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover\"><title>Bugaboo Butterfly</title><style>\n@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&display=swap');\n*{box-sizing:border-box}\nbody{margin:0;min-height:100vh;display:flex;justify-content:center;align-items:center;background:#efe9f5;font-family:'Nunito',sans-serif;padding:24px}\n.ph{width:100%;max-width:300px;background:#241a12;border-radius:54px;padding:8px;box-shadow:0 36px 74px -38px rgba(150,80,30,.5)}\n.scr{aspect-ratio:9/19.5;background:#fff4ea;border-radius:46px;overflow:hidden;display:flex;flex-direction:column;color:#33291f;position:relative}\n.isl{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:84px;height:22px;background:#241a12;border-radius:12px;z-index:6}\n.fred{font-family:'Fredoka',sans-serif}\n.body{flex:1;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;padding-bottom:98px}\n.body::-webkit-scrollbar{display:none;width:0;height:0}\n.eyes{transform-box:fill-box;transform-origin:center;animation:blink 4.5s ease-in-out infinite}\n@keyframes blink{0%,93%,100%{transform:scaleY(1)}96.5%{transform:scaleY(0.08)}}\n.gallery{position:relative;background:#fff}\n.strip{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}\n.strip::-webkit-scrollbar{display:none}\n.slide{min-width:100%;height:280px;scroll-snap-align:center;display:flex;align-items:center;justify-content:center;background:#fff}\n.slide img{max-width:82%;max-height:88%;object-fit:contain}\n.dots{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px}\n.dot{width:6px;height:6px;border-radius:50%;background:#e2d3c2}\n.dot.on{background:#ff6242;width:18px;border-radius:999px}\n.floatbtn{position:absolute;top:44px;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 28px -20px rgba(150,90,40,.45);z-index:3}\n.sect{padding:0 18px}\n.card{background:#fff;border-radius:20px;box-shadow:0 12px 28px -20px rgba(150,90,40,.45)}\n.badge{font:800 9.5px 'Nunito';padding:4px 8px;border-radius:999px;letter-spacing:.03em;background:#e3f6ef;color:#1f9d72}\n.sechd{font-family:'Fredoka';font-size:17px;font-weight:600;color:#33291f;margin:22px 0 11px}\n.chip{background:#fff;border:1.5px solid #f0e3d4;border-radius:12px;padding:8px 8px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}\n.chip .t{font:800 11px 'Nunito';color:#5a4a3a;line-height:1.15}\n.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.lst{display:flex;flex-direction:column;gap:12px}\n.li{display:flex;gap:12px;align-items:flex-start;font:600 13px 'Nunito';color:#5a4a3a;line-height:1.35}\n.spec{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f2e8db;font:600 13px 'Nunito'}\n.spec .k{color:#9a8470}.spec .v{color:#33291f;font-weight:800;text-align:right}\n.cta{position:absolute;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #f1e7d9;padding:12px 16px 20px;display:flex;align-items:center;gap:12px;z-index:5}\n.ctabtn{flex:1;text-align:center;font-family:'Fredoka';font-size:15px;font-weight:600;padding:16px;border-radius:999px}\n.stars{color:#ffb23e;letter-spacing:1px;font-size:13px}\n/* tabs */\n.tabbar{display:flex;background:#f4ece1;border-radius:12px;padding:4px;gap:4px;margin-bottom:2px}\n.tabbtn{flex:1;text-align:center;font:800 13px 'Nunito';color:#9a8470;padding:8px;border-radius:12px;cursor:pointer}\n.tabbtn.active{background:#fff;color:#ff6242;box-shadow:0 12px 28px -20px rgba(150,90,40,.45)}\n.tabpane{padding:12px 8px 5px}\n/* suitability */\n.surow{display:flex;align-items:center;gap:12px;margin-bottom:12px}\n.surow:last-child{margin-bottom:0}\n.slabel{width:98px;font:700 11px 'Nunito';color:#5a4a3a;flex-shrink:0}\n.sbar{flex:1;height:8px;background:#f0e6d8;border-radius:999px;overflow:hidden}\n.sfill{height:100%;background:linear-gradient(90deg,#ff8a6e,#ff6242);border-radius:999px}\n.sscore{width:16px;text-align:right;font:800 13px 'Nunito';color:#33291f;flex-shrink:0}\nhtml,body{touch-action:manipulation;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}</style><style>html,body{margin:0!important;height:100%!important;background:transparent!important}body{padding:0!important}.ph{max-width:none!important;width:100%!important;height:100%!important;padding:0!important;background:transparent!important;border-radius:0!important;box-shadow:none!important}.scr{width:100%!important;height:100%!important;aspect-ratio:auto!important;border-radius:0!important}*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}*{scrollbar-width:none!important;-ms-overflow-style:none!important}</style><style>@keyframes wface{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.7px)}}@keyframes weyes{0%,16%,100%{transform:translate(0,0)}26%,40%{transform:translate(2px,0)}54%,70%{transform:translate(-2px,.6px)}}@keyframes wblink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}.wsvg .wface{transform-box:fill-box;transform-origin:center;animation:wface 3.2s ease-in-out infinite}.wsvg .weyes{transform-box:fill-box;transform-origin:center;animation:weyes 5.5s ease-in-out infinite}.wsvg .wblink{transform-box:fill-box;transform-origin:50% 55%;animation:wblink 4.3s ease-in-out infinite}</style><style>@media(max-width:600px){html,body{height:100%;margin:0}body{padding:0!important;background:#fff4ea!important;display:block!important}.ph{max-width:none!important;width:100%!important;height:100vh;height:100dvh;background:none!important;border-radius:0!important;padding:0!important;box-shadow:none!important}.scr{aspect-ratio:auto!important;height:100vh;height:100dvh;width:100%!important;border-radius:0!important}.isl{display:none!important}.sb{display:none!important}.body{zoom:1.12}.nav{position:fixed!important;bottom:0!important;left:0!important;right:0!important;z-index:60}html,body{overflow:hidden!important;position:fixed!important;width:100%!important;height:100%!important;top:0!important;left:0!important;overscroll-behavior:none!important}.ph{overflow:hidden!important}.scr{overflow:hidden!important}.body,.view{overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch;overscroll-behavior:contain!important;max-width:100%!important}img{max-width:100%}}</style></head><body><div class=\"ph\"><div class=\"scr\"><div class=\"isl\"></div><div class=\"body\">", "GALHEAD": "<div class=\"gallery\"><div class=\"floatbtn back\" style=\"left:16px\"><svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#33291f\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M15 6l-6 6l6 6\"/></svg></div><div class=\"floatbtn\" style=\"right:16px\" onclick=\"toggleHeart(this)\"><svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#ff6242\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 20l-1.4-1.3C6 14.6 3 11.9 3 8.6 3 6 5 4 7.5 4c1.5 0 2.9 .7 3.5 1.8C11.6 4.7 13 4 14.5 4 17 4 19 6 19 8.6c0 3.3-3 6-7.6 10.1z\"/></svg></div>", "ASK": "<div class=\"sect\" style=\"margin-top:16px\"><div class=\"askw\" data-goto=\"wendy\" data-chat=\"prod:prod_pram_4~Bugaboo Butterfly~prod\" style=\"cursor:pointer;background:linear-gradient(135deg,#ff8a6e,#ff6242);border-radius:20px;box-shadow:0 14px 26px -12px rgba(255,98,66,.55);padding:16px 15px;margin-bottom:16px;display:flex;align-items:center;gap:12px\"><svg viewBox=\"0 0 100 100\" width=\"44\" class=\"wsvg\" style=\"flex-shrink:0\"><circle cx=\"50\" cy=\"50\" r=\"50\" fill=\"#ffd98a\"/><path d=\"M47 30 C42 25,38 26,40 30 C38 34,42 35,47 30 Z\" fill=\"#c75d76\"/><path d=\"M53 30 C58 25,62 26,60 30 C62 34,58 35,53 30 Z\" fill=\"#c75d76\"/><circle cx=\"50\" cy=\"30\" r=\"2.4\" fill=\"#a84860\"/><circle cx=\"50\" cy=\"56\" r=\"27\" fill=\"#ff7a5c\"/><circle cx=\"33.7\" cy=\"64.4\" r=\"4.4\" fill=\"#ff9e86\"/><circle cx=\"66.3\" cy=\"64.4\" r=\"4.4\" fill=\"#ff9e86\"/><circle cx=\"40\" cy=\"54\" r=\"8\" fill=\"#fff\" fill-opacity=\"0.16\" stroke=\"#3a2418\" stroke-width=\"2.4\"/><circle cx=\"60\" cy=\"54\" r=\"8\" fill=\"#fff\" fill-opacity=\"0.16\" stroke=\"#3a2418\" stroke-width=\"2.4\"/><path d=\"M48 53 q2 -1.5 4 0\" stroke=\"#3a2418\" stroke-width=\"2\" fill=\"none\"/><path d=\"M32 52.6 l-3.8 -1.4 M68 52.6 l3.8 -1.4\" stroke=\"#3a2418\" stroke-width=\"2.4\" stroke-linecap=\"round\" fill=\"none\"/><circle cx=\"40\" cy=\"55\" r=\"2.4\" fill=\"#3a2418\"/><circle cx=\"60\" cy=\"55\" r=\"2.4\" fill=\"#3a2418\"/><path d=\"M42 65 q8 7 16 0\" stroke=\"#3a2418\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"/></svg><div style=\"flex:1;color:#fff\"><div class=\"fred\" style=\"font-size:15px;font-weight:600;line-height:1.16\">Ask Wendy about Bugaboo Butterfly</div><div style=\"font:600 11px 'Nunito';color:#ffe2d8;margin-top:4px\">“Is it worth it for me?”</div></div><div style=\"background:#fff;color:#ff6242;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#ff6242\" stroke-width=\"2.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15a2 2 0 0 1 -2 2H8l-4 4V5a2 2 0 0 1 2 -2h13a2 2 0 0 1 2 2z\"/></svg></div></div></div><div class=\"sect\" style=\"margin-top:12px\" id=\"pickslot\"><div data-nogo onclick=\"makePick()\" style=\"text-align:center;background:#fff;border:1.7px solid #ff6242;color:#ff6242;font:700 13px 'Fredoka';padding:12px;border-radius:16px;cursor:pointer\">★ Make this your pick</div></div>", "R1": "</div><div id=\"toast\" style=\"position:absolute;bottom:96px;left:50%;transform:translateX(-50%) translateY(10px);background:#33291f;color:#fff;font:700 13px 'Nunito';padding:8px 16px;border-radius:999px;opacity:0;transition:.3s;z-index:7;pointer-events:none;white-space:nowrap\">Added to your shortlist</div>", "R2": "</div></div><style>.hoff-wrap{position:fixed;inset:0;z-index:200}.hoff-bg{position:absolute;inset:0;background:rgba(40,25,15,.42)}.hoff{position:absolute;left:0;right:0;bottom:0;background:#fff4ea;border-radius:24px 24px 0 0;padding:12px 18px 18px;box-shadow:0 12px 28px -20px rgba(150,90,40,.45);animation:hup .22s ease}@keyframes hup{from{transform:translateY(100%)}to{transform:translateY(0)}}.hoff-grip{width:40px;height:4px;border-radius:999px;background:#e6d7c6;margin:2px auto 12px}.hoff-title{font:600 17px 'Fredoka';color:#33291f;margin-bottom:8px}.hoff-body{font:600 13px/1.5 'Nunito';color:#6b5947;margin-bottom:12px}.hoff-note{display:flex;gap:8px;align-items:flex-start;background:#fff;border:1px solid #ffe0d3;border-radius:12px;padding:8px 11px;font:600 11px/1.4 'Nunito';color:#8a6d5b;margin-bottom:16px}.hoff-go{width:100%;background:#ff6242;color:#fff;border:none;font:700 15px 'Fredoka';padding:16px;border-radius:999px;box-shadow:0 14px 26px -12px rgba(255,98,66,.55);cursor:pointer}.hoff-cancel{width:100%;background:none;border:none;font:700 13px 'Nunito';color:#b08a68;padding:12px 0 0;cursor:pointer}.wt{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:#33291f;color:#fff;font:700 13px Nunito;padding:12px 16px;border-radius:999px;z-index:999;opacity:0;transition:opacity .2s;max-width:82%;text-align:center}</style><div id=\"hoff\" class=\"hoff-wrap\" style=\"display:none\"><div class=\"hoff-bg\" onclick=\"closeHoff()\"></div><div class=\"hoff\"><div class=\"hoff-grip\"></div><div class=\"hoff-title\" id=\"hoffTitle\"></div><div class=\"hoff-body\" id=\"hoffBody\"></div><div class=\"hoff-note\" id=\"hoffNote\"><svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#e08a5a\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"flex-shrink:0;margin-top:2px\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5M12 8h.01\"/></svg><span id=\"hoffNoteText\"></span></div><button class=\"hoff-go\" id=\"hoffGo\"></button><button class=\"hoff-cancel\" onclick=\"closeHoff()\">Not now</button></div></div><script>function wToast(m){var t=document.createElement(\"div\");t.className=\"wt\";t.textContent=m;document.body.appendChild(t);requestAnimationFrame(function(){t.style.opacity=\"1\"});setTimeout(function(){t.style.opacity=\"0\";setTimeout(function(){t.remove()},250)},1600)}var FULFIL={rent:\"affiliate\",buy:\"affiliate\"},PARTNER={rent:\"Baboodle\",buy:\"John Lewis\"},PROD=\"Bugaboo Butterfly\";function openHoff(kind){var buy=kind===\"buy\",f=FULFIL[kind],p=PARTNER[kind];document.getElementById(\"hoffTitle\").textContent=(buy?\"Buy \":\"Rent \")+PROD;var body,note;if(f===\"affiliate\"){body=buy?(\"I don't sell this myself — I'll take you to \"+p+\", where I've found it.\"):(\"I'll take you to \"+p+\" to rent this one.\");note=\"Wendy may earn a small commission — it never changes your price.\"}else{body=\"Checkout with Baboodle — \"+(buy?\"buy\":\"rent\")+\" without leaving Wendy.\";note=\"\"}document.getElementById(\"hoffBody\").textContent=body;var n=document.getElementById(\"hoffNote\");n.style.display=note?\"flex\":\"none\";document.getElementById(\"hoffNoteText\").textContent=note;var go=document.getElementById(\"hoffGo\");go.textContent=(f===\"affiliate\")?(\"Continue to \"+p):((buy?\"Buy\":\"Rent\")+\" with Baboodle\");go.onclick=function(){wToast(\"Opening \"+p+\"…\");closeHoff()};document.getElementById(\"hoff\").style.display=\"block\"}function closeHoff(){document.getElementById(\"hoff\").style.display=\"none\"}function makePick(){wToast(\"Added to your kit list ✓\")}</script><script>function toggleHeart(el){var p=el.querySelector(\"svg path\");var on=el.classList.toggle(\"saved\");p.setAttribute(\"fill\",on?\"#ff6242\":\"none\");showToast(on?\"Added to your shortlist\":\"Removed from shortlist\");try{parent.postMessage({setSave:{key:(typeof MYKEY!==\"undefined\"?MYKEY:null),saved:on,slot:(typeof SLOT!==\"undefined\"?SLOT:null)}},\"*\");}catch(e){}}function showToast(m){var t=document.getElementById(\"toast\");if(!t)return;t.textContent=m;t.style.opacity=\"1\";t.style.transform=\"translateX(-50%) translateY(0)\";clearTimeout(window._tt);window._tt=setTimeout(function(){t.style.opacity=\"0\";t.style.transform=\"translateX(-50%) translateY(10px)\"},1600)}function wbTab(el,w){var card=el.closest(\".tabcard\");card.querySelectorAll(\".tabbtn\").forEach(function(x){x.classList.remove(\"active\")});el.classList.add(\"active\");card.querySelector(\".pane-a\").style.display=w===\"a\"?\"block\":\"none\";card.querySelector(\".pane-b\").style.display=w===\"b\"?\"block\":\"none\"}</script><script>var SLOT=\"prams\",MYKEY=\"prod_pram_4\",MYNAME=\"Bugaboo Butterfly\",MYV=\"RENT\",MYPRICE=\"\\u00a316/mo\";function applyPick(p){var el=document.getElementById(\"pickslot\");if(el)el.innerHTML=(p&&p[SLOT]===MYKEY)?\"<div class=\\\"card\\\" style=\\\"padding:12px 14px;background:#e3f6ef;display:flex;align-items:center;gap:12px\\\"><div style=\\\"flex:1\\\"><div style=\\\"font:800 13px 'Nunito';color:#1f9d72\\\">This is your top pick</div><div style=\\\"font:600 11px 'Nunito';color:#5c9b84\\\">Saved to your kit list</div></div></div>\":\"<div data-nogo onclick=\\\"makePick()\\\" style=\\\"text-align:center;background:#fff;border:1.7px solid #ff6242;color:#ff6242;font:700 13px 'Fredoka';padding:12px;border-radius:16px;cursor:pointer\\\">\\u2605 Make this your pick</div>\";}function makePick(){parent.postMessage({setPick:{slot:SLOT,key:MYKEY,name:MYNAME,v:MYV,price:MYPRICE}},\"*\");var el=document.getElementById(\"pickslot\");if(el)el.innerHTML=\"<div class=\\\"card\\\" style=\\\"padding:12px 14px;background:#e3f6ef;display:flex;align-items:center;gap:12px\\\"><div style=\\\"flex:1\\\"><div style=\\\"font:800 13px 'Nunito';color:#1f9d72\\\">This is your top pick</div><div style=\\\"font:600 11px 'Nunito';color:#5c9b84\\\">Saved to your kit list</div></div></div>\";if(window.showToast)showToast(\"Added to your kit list ✓\");}window.addEventListener(\"message\",function(e){var d=e.data||{};if(d.state)applyPick(d.state);if(d.saved&&typeof MYKEY!=='undefined'&&d.saved.indexOf(MYKEY)>=0){var _hb=document.querySelector('.floatbtn');if(_hb){_hb.classList.add('saved');var _pp=_hb.querySelector('svg path');if(_pp)_pp.setAttribute('fill','#ff6242');}}});parent.postMessage({ready:1},\"*\");</script><script>(function(){var NAV=['home','kitlist','wendy','lists','profile'];function send(m){parent.postMessage(m,'*');}document.addEventListener('click',function(e){var au=e.target.closest('[data-auth]');if(au){var v=au.getAttribute('data-auth').split(':');if(v[0]==='logout'){send({auth:{kind:'logout'}});}else{send({auth:{kind:'oauth',provider:v[1]||v[0]}});}return;}if(e.target.closest('[data-nogo]'))return;var g=e.target.closest('[data-goto]');if(g){e.preventDefault();var _m={goto:g.getAttribute('data-goto')};var _c=g.getAttribute('data-chat');if(_c)_m.chat=_c;send(_m);return;}var it=e.target.closest('.nav > *');if(it&&it.parentNode&&it.parentNode.classList&&it.parentNode.classList.contains('nav')){var i=[].indexOf.call(it.parentNode.children,it);if(NAV[i]){var mm={goto:NAV[i]};if(NAV[i]==='wendy')mm.chat='home~Wendy~home';send(mm);return;}}var b=e.target.closest('.iconbtn,.floatbtn,.back');if(b){var p=b.querySelector('path');if(p&&p.getAttribute('d')==='M15 6l-6 6l6 6'){send({back:1});return;}}},true);})();</script><script>(function(){function ok(t){while(t&&t!==document.body){if(t.classList&&(t.classList.contains('body')||t.classList.contains('view')||t.scrollHeight>t.clientHeight+2&&/auto|scroll/.test(getComputedStyle(t).overflowY)))return t;t=t.parentNode;}return null;}document.addEventListener('touchmove',function(e){if(e.touches&&e.touches.length>1){e.preventDefault();return;}var s=ok(e.target);if(!s){e.preventDefault();return;}var top=s.scrollTop<=0,bot=s.scrollTop+s.clientHeight>=s.scrollHeight-1;if((top||bot)&&s.scrollHeight<=s.clientHeight+2)e.preventDefault();},{passive:false});})();</script><script>(function(){['gesturestart','gesturechange','gestureend'].forEach(function(g){document.addEventListener(g,function(e){e.preventDefault();},{passive:false});});var lt=0;document.addEventListener('touchend',function(e){var n=Date.now();if(n-lt<=350){e.preventDefault();}lt=n;},{passive:false});document.addEventListener('touchmove',function(e){if(e.touches&&e.touches.length>1)e.preventDefault();},{passive:false});})();</script></body></html>", "EYE": "<svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 12s3.5 -7 10 -7 10 7 10 7 -3.5 7 -10 7 -10 -7 -10 -7z\"/><circle cx=\"12\" cy=\"12\" r=\"2.5\"/></svg>"};

  var ORIG_CATEGORY = screens.category;

  function e(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function num(v) { var n = Number(v); return (v === null || v === undefined || v === "" || isNaN(n)) ? null : n; }
  function money(n) { return "£" + Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 }); }
  function isNA(v) { return typeof v === "string" && /^(n\/?a|not applicable)$/i.test(v.trim()); }
  function has(v) { return !(v === null || v === undefined || v === "" || isNA(v) || (Array.isArray(v) && !v.length)); }
  function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return has(x); }) : []; }
  function sp(r, k) { return r.spec && has(r.spec[k]) ? r.spec[k] : null; }
  function yn(v) { return v === true ? "Yes" : v === false ? "No" : null; }

  /* ---------- one product row -> everything the screens need ---------- */
  function model(r, all) {
    var brand = r.brand || "", name = r.name || "";
    var disp = brand && name.toLowerCase().indexOf(brand.toLowerCase()) === 0 ? name : (brand + " " + name).trim();
    var dup = all.filter(function (x) { return x.brand === r.brand && x.name === r.name; }).length > 1;
    if (dup && has(r.configuration_name)) disp += " · " + r.configuration_name;
    var rent = num(r.rent_gbp_mo), buy = num(r.buy_gbp);
    rent = rent && rent > 0 ? rent : null; buy = buy && buy > 0 ? buy : null;
    var amin = num(r.age_min_months), amax = num(r.age_max_months);
    var age = null;
    if (amin !== null) { age = (amin === 0 ? "Birth" : amin + " months") + (amax !== null ? " – " + amax + " months" : " +"); }
    var wt = num(r.spec_weight_kg);
    var bits = [];
    if (wt) bits.push(wt + " kg");
    if (amin !== null) bits.push(amin === 0 ? "from birth" : "from " + amin + " months");
    if (r.spec && r.spec.cabin_approval === true) bits.push("cabin-approved");
    return {
      r: r, key: r.id, name: disp, brand: brand, rent: rent, buy: buy, age: age, weight: wt,
      v: rent ? "RENT" : "BUY", spec: bits.join(" · "),
      price: rent ? money(rent) + "/mo" : (buy ? money(buy) : ""),
      img: has(r.hero_image_url) ? r.hero_image_url : null
    };
  }

  function thumb(m, big) {
    if (m.img) return '<img referrerpolicy="no-referrer" src="' + e(m.img) + '" alt="' + e(m.name) + '">';
    return '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;color:#c2a78f;font:700 ' + (big ? 22 : 16) + 'px Fredoka,sans-serif">' + e((m.brand || m.name).charAt(0).toUpperCase()) + '</div>';
  }

  /* ---------- the Prams list screen ---------- */
  function badge(v) {
    return v === "BUY" ? '<span class="badge" style="background:#ffe9e2;color:#ff5a3c">BUY</span>'
                       : '<span class="badge" style="background:#e3f6ef;color:#1f9d72">RENT</span>';
  }
  function card(m) {
    var price = m.price ? '<div class="pprice">' + (m.v === "RENT" ? '<div class="pfrom">from</div>' : '') + '<div><span class="pamt" style="font-size:15px">' + e(m.v === "RENT" ? money(m.rent) : money(m.buy)) + '</span>' + (m.v === "RENT" ? '<span class="pmo">/mo</span>' : '') + '</div></div>' : '';
    return '<div class="pcard" data-goto="' + e(m.key) + '" style="cursor:pointer"><div class="prow"><div class="pleft"><div class="pthumb">' + thumb(m) + '</div>' + price + '</div>' +
      '<div class="pinfo"><div><div class="pname">' + e(m.name) + '</div>' + (m.spec ? '<div class="pspec">' + e(m.spec) + '</div>' : '') + '</div><div>' + badge(m.v) + '</div></div>' +
      '<div class="pctrl"><div class="eyebtn2" title="View pram">' + TPL.EYE + '</div></div></div></div>';
  }
  function buildCategory() {
    var h = ORIG_CATEGORY;
    var a = h.indexOf("<!-- your top pick -->"), nav = h.indexOf("<!-- bottom nav -->");
    if (a < 0 || nav < 0) return h;
    var b = h.lastIndexOf("</div>", nav);
    h = h.slice(0, a) + '<div id="dyn"></div>\n    ' + h.slice(b);
    /* only show the full page when the pick is one of the live products */
    h = h.replace('if(d.state["prams"])renderFull()', 'if(d.state["prams"]&&window.dynHas(d.state["prams"]))renderFull()');
    var js = '(function(){var ST={},SV=[];function cat(){try{return (parent.CATALOG.prams||{}).items||[]}catch(e){return []}}' +
      'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;")}' +
      'window.dynHas=function(k){return cat().some(function(x){return x.key===k})};' +
      'function thumb(x){return x.img?\'<img referrerpolicy="no-referrer" src="\'+esc(x.img)+\'" alt="">\':\'<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;color:#c2a78f;font:700 16px Fredoka,sans-serif">\'+esc((x.name||"?").charAt(0))+\'</div>\'}' +
      'function card(x,feat){var rent=x.v==="RENT";var pr=x.price?\'<div class="pprice">\'+(rent?\'<div class="pfrom">from</div>\':"")+\'<div><span class="pamt" style="font-size:15px">\'+esc(rent?x.price.replace("/mo",""):x.price)+\'</span>\'+(rent?\'<span class="pmo">/mo</span>\':"")+\'</div></div>\':"";' +
      'var badge=rent?\'<span class="badge" style="background:#e3f6ef;color:#1f9d72">RENT</span>\':\'<span class="badge" style="background:#ffe9e2;color:#ff5a3c">BUY</span>\';' +
      'return \'<div class="pcard\'+(feat?" feat":"")+\'" data-goto="\'+esc(x.key)+\'" style="cursor:pointer"><div class="prow"><div class="pleft"><div class="pthumb">\'+thumb(x)+\'</div>\'+pr+\'</div><div class="pinfo"><div><div class="pname">\'+esc(x.name)+\'</div>\'+(x.spec?\'<div class="pspec">\'+esc(x.spec)+\'</div>\':"")+\'</div><div>\'+badge+\'</div></div></div>\'+(feat&&x.line?\'<div style="border-top:1px solid #f0e4d6;margin-top:12px;padding-top:12px;font:700 12px/1.45 Nunito;color:#6b5947">\'+esc(x.line)+\'</div>\':"")+\'</div>\'}' +
      'function draw(){var el=document.getElementById("dyn");if(!el)return;var its=cat(),top=null,i;for(i=0;i<its.length;i++)if(its[i].key===ST.prams)top=its[i];if(!top){el.innerHTML="";return}' +
      'var sw=\'<div class="swapbtn" data-nogo onclick="openSwap()" title="Change top pick"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ff6242" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l-3 3l3 3"/><path d="M4 7h11a4 4 0 0 1 4 4"/><path d="M17 20l3 -3l-3 -3"/><path d="M20 17h-11a4 4 0 0 1 -4 -4"/></svg></div>\';' +
      'var out=\'<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><div class="sec" style="flex:1">Top pick</div>\'+sw+\'</div>\'+card(top,true);' +
      'var sh=its.filter(function(x){return SV.indexOf(x.key)>=0&&x.key!==top.key});if(sh.length){out+=\'<div style="display:flex;align-items:center;margin:20px 0 12px"><div class="sec" style="flex:1">Shortlist</div></div>\'+sh.map(function(x){return card(x)}).join("")}el.innerHTML=out}' +
      'window.addEventListener("message",function(e){var d=e.data||{};if(d.saved)SV=d.saved;if(d.state){ST=d.state}draw()});setTimeout(draw,0);})();';
    return h.replace("</body>", "<scr" + "ipt>" + js + "</scr" + "ipt></body>");
  }

  /* ---------- the product page ---------- */
  function sect(inner) { return '<div class="sect">' + inner + "</div>"; }
  function hd(t) { return '<div class="sechd">' + e(t) + "</div>"; }
  function specRow(k, v, last) { return v === null ? "" : '<div class="spec"><span class="k">' + e(k) + '</span><span class="v">' + e(v) + "</span></div>"; }
  function listHtml(a) { return '<div class="lst">' + a.map(function (x) { return '<div class="li">' + e(x) + "</div>"; }).join("") + "</div>"; }

  function buildProduct(m) {
    var r = m.r, parts = [];
    /* gallery */
    parts.push(TPL.GALHEAD + '<div class="strip"><div class="slide" style="background:radial-gradient(120% 90% at 50% 25%,#fff,#efe9fb)">' +
      (m.img ? '<img referrerpolicy="no-referrer" src="' + e(m.img) + '" alt="' + e(m.name) + '" style="max-width:82%;max-height:82%;object-fit:contain;mix-blend-mode:multiply">'
             : '<div class="fred" style="font-size:44px;font-weight:600;color:#d9c7b4;text-align:center;padding:0 24px">' + e(m.name) + "</div>") +
      '</div></div><div class="dots"><div class="dot on"></div></div></div>');
    /* title, rating, prices */
    var rating = num(r.rating), rc = num(r.review_count), stars = "";
    if (rating) { var n = Math.max(0, Math.min(5, Math.round(rating))); stars = "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }
    var prices = "";
    if (m.rent) prices += '<div><div style="font:800 11px \'Nunito\';color:#1f9d72;letter-spacing:.05em">RENT</div><div style="margin-top:4px"><span style="font:700 11px \'Nunito\';color:#9a8470">from </span><span class="fred" style="font-size:22px;font-weight:600;color:#ff6242">' + e(money(m.rent)) + '</span><span style="font:700 11px \'Nunito\';color:#9a8470">/mo</span></div></div>';
    if (m.buy) prices += '<div><div style="font:800 11px \'Nunito\';color:#9a8470;letter-spacing:.05em">BUY</div><div style="margin-top:4px"><span class="fred" style="font-size:22px;font-weight:600;color:#33291f">' + e(money(m.buy)) + "</span></div></div>";
    parts.push('<div class="sect"><div style="margin-top:16px"><div style="font:800 11px \'Nunito\';color:#a98a72;letter-spacing:.08em">' + e(m.brand.toUpperCase()) + '</div><div class="fred" style="font-size:26px;font-weight:600;color:#33291f;margin-top:2px">' + e(m.name) + "</div>" +
      (rating ? '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span class="stars">' + stars + '</span><span style="font:700 13px \'Nunito\';color:#9a8470">' + e(rating) + (rc ? " · " + rc + " review" + (rc === 1 ? "" : "s") : "") + "</span></div>" : "") +
      "</div>" + (prices ? '<div style="display:flex;gap:24px;margin-top:16px">' + prices + "</div>" : "") + "</div>");
    /* ask Wendy + pick */
    parts.push(TPL.ASK.split("prod:prod_pram_4~Bugaboo Butterfly~prod").join("prod:" + e(m.key) + "~" + e(m.name) + "~prod").split("Ask Wendy about Bugaboo Butterfly").join("Ask Wendy about " + e(m.name)));
    /* about */
    if (has(r.summary) || has(r.description)) {
      parts.push(sect(hd("About the " + m.name) + '<div class="card" style="padding:16px">' +
        (has(r.summary) ? '<div style="font:800 14px/1.4 \'Nunito\';color:#33291f">' + e(r.summary) + "</div>" : "") +
        (has(r.description) ? '<div style="font:600 13px/1.5 \'Nunito\';color:#6b5947;margin-top:' + (has(r.summary) ? 10 : 0) + 'px">' + e(r.description) + "</div>" : "") + "</div>"));
    }
    /* recommendation */
    var vline = has(r.verdict_line) ? r.verdict_line : null, expl = has(r.rent_vs_buy_explanation) ? r.rent_vs_buy_explanation : null;
    if (vline) {
      var vv = String(r.verdict || "").toUpperCase(); if (vv === "RENT" && !m.rent) vv = m.buy ? "BUY" : "";
      var pal = vv === "BUY" ? ["#ff5a3c", "#fff2ec", "#ffd9cc", "#8a5b4a"] : vv === "SKIP" ? ["#9a8470", "#f4ede5", "#e6d7c6", "#6b5947"] : ["#1f9d72", "#f2fbf6", "#cdeede", "#4a6a5a"];
      parts.push(sect(hd("Wendy's verdict") + '<div class="card" style="border:1.5px solid ' + pal[2] + ";background:" + pal[1] + ';padding:16px">' +
        (vv ? '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="font:800 11px \'Nunito\';background:' + pal[0] + ';color:#fff;padding:4px 11px;border-radius:999px">' + vv + " IT</span></div>" : "") +
        '<div style="font:700 14px/1.45 \'Nunito\';color:' + pal[0] + '">' + e(vline) + "</div>" +
        (expl ? '<div style="font:600 13px/1.45 \'Nunito\';color:' + pal[3] + ';margin-top:10px">' + e(expl) + "</div>" : "") + "</div>"));
    }
    /* highlights */
    var hl = arr(r.highlights).slice(0, 8);
    if (hl.length) parts.push(sect(hd("Key highlights") + '<div class="row2">' + hl.map(function (x) { return '<div class="chip"><span class="t">' + e(x) + "</span></div>"; }).join("") + "</div>"));
    /* best for / not ideal for */
    var bf = arr(r.best_for), ni = arr(r.not_ideal_for);
    if (bf.length && ni.length) {
      parts.push(sect(hd("Best for / not ideal for") + '<div class="tabcard card" style="padding:8px 8px 8px"><div class="tabbar"><div class="tabbtn active" data-nogo onclick="wbTab(this,\'a\')">Best for</div><div class="tabbtn" data-nogo onclick="wbTab(this,\'b\')">Not ideal for</div></div><div class="tabpane pane-a" style="display:block">' + listHtml(bf) + '</div><div class="tabpane pane-b" style="display:none">' + listHtml(ni) + "</div></div>"));
    } else if (bf.length || ni.length) {
      parts.push(sect(hd(bf.length ? "Best for" : "Not ideal for") + '<div class="card" style="padding:16px">' + listHtml(bf.length ? bf : ni) + "</div>"));
    }
    /* how long people keep it (only for products that can be rented) */
    var months = num(r.avg_rental_months);
    if (m.rent && months) {
      parts.push(sect(hd("How long people keep it") + '<div class="card" style="padding:16px;display:flex;align-items:center;gap:16px"><div style="text-align:center;flex-shrink:0"><div class="fred" style="font-size:26px;font-weight:600;color:#ff6242;line-height:1">' + e(months) + '</div><div style="font:700 9.5px \'Nunito\';color:#9a8470">MONTHS AVG</div></div><div style="font:600 13px \'Nunito\';color:#7a6a58;line-height:1.4">Families typically keep the ' + e(m.name) + " for around <b>" + e(months) + " months</b>.</div></div>"));
    }
    /* suitability */
    var sc = (r.spec && r.spec.scores) || {}, rows = [["city", "Living in a flat"], ["boot", "Car boot"], ["transit", "Public transport"], ["offroad", "All terrain"], ["travel", "Travelling"]].filter(function (x) { return num(sc[x[0]]) !== null; });
    if (rows.length) parts.push(sect(hd("Suitability") .replace("</div>", ' <span style="font:700 11px \'Nunito\';color:#9a8470">· scored out of 10</span></div>') + '<div class="card" style="padding:16px 15px">' + rows.map(function (x) { var v = num(sc[x[0]]); return '<div class="surow"><span class="slabel">' + x[1] + '</span><div class="sbar"><div class="sfill" style="width:' + Math.max(0, Math.min(10, v)) * 10 + '%"></div></div><span class="sscore">' + e(v) + "</span></div>"; }).join("") + "</div>"));
    /* full specs */
    var specs = [];
    function add(k, v) { if (v !== null && v !== undefined && v !== "" && !isNA(v)) specs.push(specRow(k, String(v))); }
    add("Weight", m.weight ? m.weight + " kg" : null);
    add("Open size", has(r.dimensions_open) ? r.dimensions_open : null);
    add("Folded size", has(r.dimensions_folded) ? r.dimensions_folded : null);
    add("Max child weight", num(r.max_child_kg) ? num(r.max_child_kg) + " kg" : null);
    add("Suitable from", m.age);
    add("Basket", has(r.basket_size) ? r.basket_size : null);
    add("Fold", sp(r, "fold_type")); add("Wheels", sp(r, "wheels")); add("Suspension", sp(r, "suspension")); add("Handlebar height", sp(r, "handlebar"));
    add("Cabin approval", yn(r.spec && r.spec.cabin_approval)); add("Overnight sleep certified", yn(r.sleep_safe_cert));
    add("UK launch date", sp(r, "launch_date"));
    add("In the box", arr(r.accessories_included).join(", "));
    add("Essential extras", arr(r.essential_extras).join(", "));
    if (specs.length) parts.push(sect(hd("Full specs") + '<div class="card" style="padding:2px 14px 6px">' + specs.join("") + "</div>"));
    /* where to buy */
    var retailer = sp(r, "buy_retailer"), buyUrl = sp(r, "buy_url"), rentUrl = m.rent ? sp(r, "rent_url") : null;
    if (retailer) parts.push('<div class="sect" style="margin-bottom:20px"><div style="display:flex;align-items:center;gap:8px;margin-top:16px;font:700 13px \'Nunito\';color:#1f9d72">Available at ' + e(retailer) + "</div></div>");
    /* buttons */
    var cta = "";
    if (rentUrl) cta += '<div class="ctabtn" style="background:#ff6242;color:#fff;box-shadow:0 14px 26px -12px rgba(255,98,66,.55)" onclick="openHoff(\'rent\')">Rent now</div>';
    if (buyUrl) cta += '<div class="ctabtn" style="background:#33291f;color:#fff" onclick="openHoff(\'buy\')">Buy now</div>';
    var R2 = TPL.R2;
    var a = R2.indexOf("var FULFIL="), b = R2.indexOf(";function openHoff");
    R2 = R2.slice(0, a) + "var FULFIL={rent:\"affiliate\",buy:\"affiliate\"},PARTNER={rent:\"Baboodle\",buy:" + JSON.stringify(retailer || "the retailer") + "},PROD=" + JSON.stringify(m.name) + ",URLS={rent:" + JSON.stringify(rentUrl || "") + ",buy:" + JSON.stringify(buyUrl || "") + "}" + R2.slice(b);
    R2 = R2.replace('go.onclick=function(){wToast("Opening "+p+"…");closeHoff()}', 'go.onclick=function(){wToast("Opening "+p+"…");closeHoff();var u=URLS[kind];if(u)window.open(u,"_blank","noopener")}');
    R2 = R2.replace('document.getElementById("hoffBody").textContent=body;', 'if(kind==="rent"){body="I\'ll take you to Baboodle to rent this one.";note=""}document.getElementById("hoffBody").textContent=body;');
    R2 = R2.replace(/var SLOT="prams",MYKEY="prod_pram_4",MYNAME="Bugaboo Butterfly",MYV="RENT",MYPRICE="[^"]*";/, function () {
      return "var SLOT=\"prams\",MYKEY=" + JSON.stringify(m.key) + ",MYNAME=" + JSON.stringify(m.name) + ",MYV=" + JSON.stringify(m.v) + ",MYPRICE=" + JSON.stringify(m.price) + ";";
    });
    var title = "<title>" + e(m.name) + "</title>";
    var H = TPL.H.replace(/<title>[^<]*<\/title>/, function () { return title; });
    return H + parts.join("") + TPL.R1 + (cta ? '<div class="cta">' + cta + "</div></div></div>" : "</div></div>") + R2.replace(/^<\/div><\/div>/, "");
  }

  /* ---------- apply ---------- */
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function apply(rows) {
    var models = rows.map(function (r) { return model(r, rows); });
    models.forEach(function (m) { screens[m.key] = buildProduct(m); });
    var items = models.map(function (m) { return { key: m.key, name: m.name, spec: m.spec, v: m.v, price: m.price, img: m.img, line: has(m.r.verdict_line) ? m.r.verdict_line : "" }; });
    CATALOG.prams = { label: "pram", def: items[0].key, items: items };
    /* any other list that still holds an older copy of a published pram: swap it for the live one */
    Object.keys(CATALOG).forEach(function (k) {
      if (k === "prams" || !CATALOG[k].items) return;
      CATALOG[k].items = CATALOG[k].items.map(function (it) {
        for (var i = 0; i < items.length; i++) { if (norm(items[i].name).indexOf(norm(it.name)) === 0 && norm(it.name).length > 4) return items[i]; }
        return it;
      });
    });
    screens.category = buildCategory();
    try { if (typeof sendState === "function") sendState(); } catch (x) {}
  }

  var url = SUPA_URL + "/rest/v1/products?select=*&spec=cs." + encodeURIComponent('{"published":true}') + "&order=sort_order.asc,name.asc";
  fetch(url, { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY } })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) { if (Array.isArray(rows) && rows.length) apply(rows); })
    .catch(function () { /* keep the built-in screens */ });
})();
