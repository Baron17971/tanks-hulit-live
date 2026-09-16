(function () {
  'use strict';

  var app = document.getElementById('app');
  var toastBox = document.getElementById('toast');
  var pollTimer = null;

  var lesson = {
    title: 'מטנקי עמק הבכא לטנקיסטיות בחולית',
    subtitle: 'מסיפורי הגבורה של מלחמת יום הכיפורים אל גבורת שבעה באוקטובר',
    organizingQuestion: 'מה גורם לאדם לקבל אחריות ולפעול כאשר הכול סביבו משתבש?',
    survey: {
      title: 'דילמת פתיחה',
      question: 'מה תעשו?',
      scenario: 'אתם מפקדים על כוח קטן. הקשר עם הדרגים שמעליכם חלקי, המידע אינו ברור ומולכם כוח גדול בהרבה. נסיגה עשויה להציל אתכם, אך היא עלולה להותיר אזרחים או כוחות אחרים ללא הגנה.',
      options: [
        'נשארים וממשיכים במשימה',
        'נסוגים כדי להתארגן מחדש',
        'מנסים לחבור לכוח נוסף',
        'פועלים בדרך אחרת'
      ]
    },
    cloud: {
      title: 'ענן הערכים הכיתתי',
      question: 'מהו הערך הכי בולט בסיפורן של הטנקיסטיות מחולית?',
      intro: 'לאחר שדרגתם שלושה ערכים, שוחחתם וניסיתם להגיע להסכמה — בחרו עכשיו ערך אחד בלבד.',
      options: ['אחריות','רעות','דבקות במשימה','אומץ לב','מקצועיות','מנהיגות','יוזמה']
    },
    gameUrl: 'https://oz-under-fire-jeopardy.baranat.chatgpt.site/'
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function toast(text) { if (!toastBox) return; toastBox.textContent = text; toastBox.classList.add('show'); setTimeout(function(){ toastBox.classList.remove('show'); }, 1800); }
  function query() { return new URLSearchParams(location.search); }
  function uid() { var key='tanks-hulit-voter'; var v=localStorage.getItem(key); if(!v){v=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());localStorage.setItem(key,v);} return v; }
  function teacherStoreKey(code) { return 'tanks-hulit-teacher-'+code; }
  function joinUrl(code) { return location.origin + '/join?code=' + encodeURIComponent(code); }
  function teacherUrl(code, token) { return location.origin + '/teacher?code=' + encodeURIComponent(code) + '&token=' + encodeURIComponent(token); }

  async function apiGet(code, voterId, token) {
    var u='/api/room?code='+encodeURIComponent(code);
    if(voterId) u+='&voterId='+encodeURIComponent(voterId);
    if(token) u+='&teacherToken='+encodeURIComponent(token);
    var r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error('get'); return r.json();
  }
  async function apiPost(body) {
    var r=await fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var data={}; try{data=await r.json();}catch(e){}
    if(!r.ok){var err=new Error(data.error||'request');err.code=data.error;throw err;} return data;
  }

  function stopPoll(){ if(pollTimer){clearInterval(pollTimer);pollTimer=null;} }
  function startPoll(fn, ms){ stopPoll(); pollTimer=setInterval(fn,ms||1400); }

  function renderHome(){
    stopPoll();
    var recent='';
    try{ recent=localStorage.getItem('tanks-hulit-last-room')||''; }catch(e){}
    app.innerHTML = '<section class="hero"><h1>'+esc(lesson.title)+'</h1><p>'+esc(lesson.subtitle)+'</p><div class="question">'+esc(lesson.organizingQuestion)+'</div></section>'+ 
      '<div class="grid two"><section class="card"><h2>ניהול השיעור</h2><p class="muted">האפליקציה מרכזת את שלוש הפעילויות הדיגיטליות לפי סדר השיעור.</p>'+ 
      guide(1,'סקר פתיחה','פתחו כיתה, הקרינו QR ואפשרו הצבעה אישית לפני הדיון.')+
      guide(2,'ענן הערכים','לאחר סיפור הטנקיסטיות בחולית עברו לענן. אותו קישור תלמידים נשאר פעיל.')+
      guide(3,'משחק מסכם','בסיום פתחו את „עוז תחת אש” ממסך המורה. המשחק נשאר כפי שנבנה.')+
      '<div class="field"><label for="className">שם הכיתה — לא חובה</label><input id="className" maxlength="60" placeholder="לדוגמה: י׳2"></div><div class="btns"><button class="btn pri" id="createRoom">פתיחת כיתה חדשה</button></div></section>'+ 
      '<section class="card"><h2>כבר פתחתם כיתה?</h2><p class="muted">אם מסך המורה נסגר בטעות, אפשר להמשיך מאותה כיתה מהמכשיר שבו נפתחה.</p>'+ 
      (recent?'<div class="btns"><button class="btn ghost" id="resumeRecent">חזרה לכיתה האחרונה</button></div>':'<p class="tiny">לא נמצאה כיתה שמורה במכשיר זה.</p>')+
      '<div class="scenario"><strong>סדר הפעילויות:</strong><br>1. סקר הדילמה<br>2. ענן הערכים<br>3. עוז תחת אש</div></section></div>';
    document.getElementById('createRoom').onclick=createRoom;
    if(recent) document.getElementById('resumeRecent').onclick=function(){ location.href=recent; };
  }
  function guide(n,t,d){return '<div class="teacher-guide"><div class="num">'+n+'</div><div><strong>'+esc(t)+'</strong><p>'+esc(d)+'</p></div></div>';}

  async function createRoom(){
    var btn=document.getElementById('createRoom'); btn.disabled=true; btn.textContent='פותח כיתה…';
    try{
      var className=(document.getElementById('className').value||'').trim();
      var data=await apiPost({action:'create',className:className});
      var url=teacherUrl(data.code,data.teacherToken);
      localStorage.setItem(teacherStoreKey(data.code),data.teacherToken);
      localStorage.setItem('tanks-hulit-last-room',url);
      location.href=url;
    }catch(e){toast('לא הצלחנו לפתוח כיתה. נסו שוב.');btn.disabled=false;btn.textContent='פתיחת כיתה חדשה';}
  }

  function stageMeta(stage){
    if(stage===1) return ['סקר פתיחה','דילמת קבלת החלטות'];
    if(stage===2) return ['ענן הערכים','בחירה כיתתית'];
    return ['משחק מסכם','עוז תחת אש'];
  }

  async function renderTeacher(code, token){
    try{
      var room=await apiGet(code,null,token); if(!room.teacher) throw new Error('auth');
      var studentLink=joinUrl(code); var meta=stageMeta(room.activeStage);
      app.innerHTML='<section class="card"><div class="room-head"><div><div class="eyebrow">מסך מורה'+(room.className?' · '+esc(room.className):'')+'</div><h2 style="margin:3px 0 0">'+esc(meta[0])+'</h2><div class="muted">'+esc(meta[1])+'</div></div><div><div class="tiny">קוד כיתה</div><div class="room-code">'+esc(code)+'</div></div></div>'+stageStrip(room.activeStage)+'</section>'+ 
      '<div class="grid two" style="margin-top:20px"><section class="card">'+teacherActivity(room)+'</section><section class="card">'+shareBlock(studentLink,code)+'</section></div>';
      wireTeacher(room,code,token);
      startPoll(async function(){ try{var fresh=await apiGet(code,null,token); updateTeacherLive(fresh);}catch(e){} },1200);
    }catch(e){
      stopPoll(); app.innerHTML='<section class="card"><h2>לא ניתן לפתוח את מסך המורה</h2><p class="muted">קישור המורה אינו תקין או שהכיתה כבר אינה זמינה.</p><div class="btns"><button class="btn pri" onclick="location.href=\'/\'">חזרה לפתיחה</button></div></section>';
    }
  }

  function stageStrip(active){
    return '<div class="stage-strip">'+[1,2,3].map(function(n){var m=stageMeta(n);return '<button class="stage '+(active===n?'on':'')+'" data-stage="'+n+'"><b>'+n+'. '+esc(m[0])+'</b><small>'+esc(m[1])+'</small></button>';}).join('')+'</div>';
  }

  function shareBlock(link,code){
    return '<h3>כניסת תלמידים</h3><p class="muted">אותו QR ואותו קישור מלווים את הכיתה גם בסקר וגם בענן הערכים.</p><div class="share"><div class="qr"><img alt="QR לכניסת תלמידים" src="/api/qr?text='+encodeURIComponent(link)+'"></div><div><div class="share-link">'+esc(link)+'</div><div class="btns"><button class="btn ghost" id="copyLink">העתקת קישור</button></div><p class="tiny">אפשר גם להיכנס עם קוד הכיתה: <strong>'+esc(code)+'</strong></p></div></div>';
  }

  function teacherActivity(room){
    if(room.activeStage===3){
      return '<div class="game-card card" style="box-shadow:none"><div class="eyebrow">שלב 3 · סיום</div><div class="game-title">עוז תחת אש</div><p>משחק הידע המסכם על עמק הבכא והטנקיסטיות בחולית. המשחק נפתח בחלון חדש ונשאר בדיוק כפי שנבנה.</p><a class="game-link" href="'+lesson.gameUrl+'" target="_blank" rel="noopener">פתיחת המשחק המסכם ↗</a></div><div class="btns"><button class="btn ghost" data-goto="2">חזרה לענן הערכים</button></div>';
    }
    var isOpen=room.status==='open';
    var resultHtml=room.activeStage===1?barsHtml(room.results,lesson.survey.options):cloudHtml(room.results,lesson.cloud.options);
    var prompt=room.activeStage===1?'<div class="scenario">'+esc(lesson.survey.scenario)+'</div><div class="q">'+esc(lesson.survey.question)+'</div>':'<div class="q">'+esc(lesson.cloud.question)+'</div><p class="muted">'+esc(lesson.cloud.intro)+'</p>';
    return '<div class="statusline"><span class="dot '+(isOpen?'open':'closed')+'"></span><strong>'+(isOpen?'השלב פתוח לתלמידים':'השלב סגור לתלמידים')+'</strong></div>'+prompt+
      '<div class="btns"><button class="btn '+(isOpen?'danger':'teal')+'" id="toggleStatus">'+(isOpen?'סגירת ההצבעה':'פתיחת ההצבעה')+'</button><button class="btn ghost" id="toggleResults">'+(room.resultsVisible?'הסתרת התוצאות':'חשיפת התוצאות')+'</button><button class="btn ghost" id="resetVotes">איפוס תשובות השלב</button></div><div id="teacherResults" style="margin-top:22px">'+resultHtml+'</div>';
  }

  function barsHtml(results,options){
    results=results||{counts:Array(options.length).fill(0),total:0}; var total=results.total||0;
    return '<div class="bars">'+options.map(function(label,i){var n=(results.counts&&results.counts[i])||0;var p=total?Math.round(n*100/total):0;return '<div class="barline"><div class="barlabel">'+esc(label)+'</div><div class="track"><div class="fill" style="width:'+p+'%"></div></div><div class="pct">'+p+'%</div></div>';}).join('')+'</div><div class="total">'+total+' משתתפים הצביעו</div>';
  }
  function cloudHtml(results,options){
    results=results||{counts:Array(options.length).fill(0),total:0}; var max=Math.max.apply(Math,[1].concat(results.counts||[]));
    var words=options.map(function(label,i){var n=(results.counts&&results.counts[i])||0;var size=22+Math.round((n/max)*34);return '<span class="cloud-word '+(n?'':'zero')+'" style="font-size:'+size+'px" title="'+n+' הצבעות">'+esc(label)+'</span>';}).join('');
    return '<div class="cloud">'+words+'</div><div class="total">'+(results.total||0)+' משתתפים בחרו ערך</div>';
  }

  function wireTeacher(room,code,token){
    Array.prototype.forEach.call(document.querySelectorAll('[data-stage]'),function(b){b.onclick=function(){setTeacherStage(Number(b.dataset.stage),code,token);};});
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'),function(b){b.onclick=function(){setTeacherStage(Number(b.dataset.goto),code,token);};});
    var copy=document.getElementById('copyLink'); if(copy) copy.onclick=function(){navigator.clipboard.writeText(joinUrl(code)).then(function(){toast('הקישור הועתק');});};
    var t=document.getElementById('toggleStatus'); if(t) t.onclick=async function(){await teacherAction(code,token,{action:'setStatus',status:room.status==='open'?'closed':'open'});};
    var v=document.getElementById('toggleResults'); if(v) v.onclick=async function(){await teacherAction(code,token,{action:'setVisibility',resultsVisible:!room.resultsVisible});};
    var r=document.getElementById('resetVotes'); if(r) r.onclick=async function(){if(confirm('לאפס את כל התשובות בשלב הזה?')) await teacherAction(code,token,{action:'reset'});};
  }
  async function setTeacherStage(stage,code,token){ await teacherAction(code,token,{action:'setStage',stage:stage}); }
  async function teacherAction(code,token,payload){
    try{payload.code=code;payload.teacherToken=token;await apiPost(payload);await renderTeacher(code,token);}catch(e){toast('הפעולה לא נשמרה. נסו שוב.');}
  }
  function updateTeacherLive(room){
    var results=document.getElementById('teacherResults'); if(!results||room.activeStage===3)return;
    results.innerHTML=room.activeStage===1?barsHtml(room.results,lesson.survey.options):cloudHtml(room.results,lesson.cloud.options);
  }

  async function renderStudent(code){
    var voterId=uid();
    try{
      var room=await apiGet(code,voterId,null);
      var activity='';
      if(room.activeStage===1) activity=studentSurvey(room);
      else if(room.activeStage===2) activity=studentCloud(room);
      else activity=studentGame(room);
      app.innerHTML='<section class="card"><div class="eyebrow">'+(room.className?esc(room.className)+' · ':'')+'פעילות תלמידים</div><h2>'+esc(stageMeta(room.activeStage)[0])+'</h2>'+activity+'</section>';
      wireStudent(room,code,voterId);
      startPoll(async function(){try{var fresh=await apiGet(code,voterId,null); if(fresh.activeStage!==room.activeStage||fresh.version!==room.version){renderStudent(code);}}catch(e){}},1300);
    }catch(e){stopPoll();app.innerHTML='<section class="card"><h2>הכיתה אינה זמינה</h2><p class="muted">בדקו את הקישור או בקשו מהמורה להציג שוב את ה־QR.</p></section>';}
  }
  function studentSurvey(room){
    var closed=room.status!=='open';
    return '<div class="scenario">'+esc(lesson.survey.scenario)+'</div><div class="q">'+esc(lesson.survey.question)+'</div>'+(closed?'<div class="waiting">המורה עדיין לא פתח/ה את הסקר.</div>':voteButtons(lesson.survey.options,room.myVote))+(room.myVote!==null?'<div class="confirm">✓ הבחירה נקלטה</div>':'')+(room.resultsVisible&&room.results?'<div style="margin-top:22px">'+barsHtml(room.results,lesson.survey.options)+'</div>':'');
  }
  function studentCloud(room){
    var closed=room.status!=='open';
    return '<div class="q">'+esc(lesson.cloud.question)+'</div><p class="muted">'+esc(lesson.cloud.intro)+'</p>'+(closed?'<div class="waiting">המורה עדיין לא פתח/ה את ענן הערכים.</div>':voteButtons(lesson.cloud.options,room.myVote))+(room.myVote!==null?'<div class="confirm">✓ הערך נקלט</div>':'')+(room.resultsVisible&&room.results?'<div style="margin-top:22px">'+cloudHtml(room.results,lesson.cloud.options)+'</div>':'');
  }
  function studentGame(){ return '<div class="game-card card" style="box-shadow:none"><div class="game-title">עוז תחת אש</div><p>עברנו למשחק המסכם. הביטו במסך הכיתה ופעלו לפי הנחיות המורה.</p></div>'; }
  function voteButtons(options,myVote){ return '<div class="votegrid">'+options.map(function(label,i){return '<button class="vote '+(myVote===i?'sel':'')+'" data-answer="'+i+'">'+esc(label)+'</button>';}).join('')+'</div>'; }
  function wireStudent(room,code,voterId){
    Array.prototype.forEach.call(document.querySelectorAll('[data-answer]'),function(b){b.onclick=async function(){
      Array.prototype.forEach.call(document.querySelectorAll('[data-answer]'),function(x){x.disabled=true;});
      try{await apiPost({action:'vote',code:code,voterId:voterId,answer:Number(b.dataset.answer)});toast(room.activeStage===2?'✓ הערך נקלט':'✓ הבחירה נקלטה');await renderStudent(code);}catch(e){toast(e.code==='poll_closed'?'ההצבעה נסגרה':'לא הצלחנו לשמור. נסו שוב.');Array.prototype.forEach.call(document.querySelectorAll('[data-answer]'),function(x){x.disabled=false;});}
    };});
  }

  function boot(){
    var q=query(); var code=q.get('code'); var path=location.pathname;
    if(path==='/teacher'&&code){var token=q.get('token')||localStorage.getItem(teacherStoreKey(code))||''; if(q.get('token'))localStorage.setItem(teacherStoreKey(code),q.get('token')); renderTeacher(code,token); return;}
    if((path==='/join'||q.get('student')==='1')&&code){renderStudent(code);return;}
    renderHome();
  }
  boot();
})();
