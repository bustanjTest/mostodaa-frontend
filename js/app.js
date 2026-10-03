/* =========================================================
   نظام عمولات مستودع مسروجي — واجهة متصلة بالباك-إند الحقيقي

   - النظام مقسم لقسمين: أدوية (MEDICINE) وكوزمتك (COSMETICS).
   - الصيدلي حساب واحد يقدر يبيع بالقسمين، ويختار القسم بعد الدخول
     (شاشة deptChoice) قبل ما يوصل لصفحة إضافة عملية بيع، ويقدر
     يبدّل القسم بأي وقت من زر بأعلى الشاشة.
   - نوع أدمن واحد بصلاحيات كاملة: بعد الدخول بيختار "لوحة الأدوية" أو
     "لوحة الكوزمتك"، وبيقدر يبدّل بينهم بأي وقت. صفحة "الدفعات الشهرية"
     مشتركة للقسمين (تحويل واحد لكل صيدلي).
   - دخول الأدمن (أي نوع) بيصير باسم مستخدم (username) مش رقم هاتف،
     فبنميّزه تلقائيًا: أي إدخال مش 10 أرقام بالضبط يعتبر محاولة
     دخول أدمن.
   - ميزة "نسيت كلمة المرور" بالنموذج الأصلي كانت بترجع كلمة المرور
     مباشرة (تجريبي فقط) — الباك-إند الحقيقي ما بيدعم هيك شي (ولا يجب
     إنه يدعمه أصلاً لأسباب أمنية)، فحولناها لشاشة إرشادية فقط.
   ========================================================= */

/* ---------------- إعدادات ---------------- */
const API_BASE = (globalThis.MOSTODAA_API_BASE || 'https://mostodaa-backend-3d1m.onrender.com/api');

const JORDAN_CITIES = ['عمّان','إربد','الزرقاء','البلقاء (السلط)','المفرق','الكرك','معان','الطفيلة','مأدبا','جرش','عجلون','العقبة'];
const DEPARTMENTS = [ { value:'MEDICINE', label:'الأدوية', icon:'💊' }, { value:'COSMETICS', label:'الكوزمتك', icon:'💄' } ];
function deptLabel(dep){ const d = DEPARTMENTS.find(x=>x.value===dep); return d ? d.label : dep; }

/* ---------------- الحالة العامة ---------------- */
// الجلسة محفوظة بكوكي httpOnly من السيرفر (مش localStorage) — جافاسكربت ما بيقدر
// يقرأها أو يعرف وجودها مسبقًا، فما في متغيّر "token" محلي؛ كل طلب بيبعت الكوكي
// تلقائيًا (credentials:'include')، والسيرفر هو اللي بيقرر لو الجلسة صالحة.
let currentUser = null; // من /users/me -> { type:'pharmacist'|'admin', ... }
let CATEGORIES = [];    // أصناف القسم الحالي

let currentScreen = 'landing';
let activeTab = 'add';

// القسم المختار حاليًا: صيدلي (بعد شاشة الاختيار) / أدمن (اللوحة اللي دخلها: MEDICINE أو COSMETICS)
let selectedDepartment = null;
let adminDeptFilter = '';
let adminPanelChosen = false; // الأدمن لازم يختار اللوحة (أدوية/كوزمتك) بعد الدخول

// نوع عملية الكوزمتك المختار حاليًا (صيدلي فقط، بعد اختيار قسم الكوزمتك):
// 'NORMAL' = بيع عادي / 'ASIL' = تعويض الأصيل / 'ZAROZA' = تعويض زاروزا
// null = لسا ما اختار (بتظهر شاشة الاختيار). قسم الأدوية دايمًا NORMAL مباشرة.
let saleMode = null;
const SALE_MODES = [
  { value:'NORMAL', label:'تسجيل عملية بيع', icon:'🧾' },
  { value:'ASIL',   label:'تسجيل تعويض الأصيل', icon:'🔄' },
  { value:'ZAROZA', label:'تسجيل تعويض زاروزا', icon:'🔄' },
];
function saleModeLabel(m){ const x = SALE_MODES.find(s=>s.value===m); return x ? x.label : 'بيع عادي'; }

// أصناف تعويض الأصيل/زاروزا (مع السعر) — تُحمَّل حسب النوع والقسم عند الحاجة
let compensationItemsCache = { ASIL:null, ZAROZA:null };

// تسجيل / دخول
let pendingReg = {};
let otpCode = null;       // يظهر فقط بوضع التطوير المحلي (OTP_DEV_MODE)، بالإنتاج ما بيرجع من السيرفر أبدًا
let otpVerified = false;
let verificationToken = null;
let regPhoneExists = false; // الرقم مسجّل مسبقًا → نعرض زر استعادة كلمة المرور
let otpSent = false;        // تم إرسال رمز التحقق (نعرض حقل إدخاله)
// استعادة كلمة المرور: step 1=رقم الهاتف، 2=رمز التحقق، 3=كلمة المرور الجديدة
let forgot = { step:1, phone:'', resetToken:null, devCode:null };
// تحقق بخطوتين للأدمن
let admin2fa = { challengeToken:null, maskedPhone:'', devCode:null };
// تغيير معلومات الاستلام (الصيدلي): مسودة + حالة رمز التحقق
let payoutDraft = null;      // { type, value }
let payoutOtpSent = false;
let payoutOtpDev = null;
let payoutIntroAcked = false; // أول مرة (قبل ما يدخل بيانات الاستلام): وافق على شاشة التعريف؟
let payoutEditUnlocked = false; // هل الحقول مفتوحة للتعديل حاليًا (بعد التحقق من الرمز)؟
let payoutEditOtpSent = false;  // تم إرسال رمز فتح التعديل
let payoutEditOtpDev = null;    // رمز فتح التعديل (وضع التطوير فقط، لحد ما توصل خدمة الرسائل)
let payoutEditCode = '';        // الرمز اللي كتبه المستخدم لفتح التعديل، بيترسل مع طلب الحفظ للتحقق منه بالسيرفر
// كود إحالة جاء من رابط دعوة (?ref=CODE) — يتعبى تلقائيًا بخطوة التسجيل لو موجود
let incomingReferralCode = null;

// إضافة/تعديل عملية بيع
let addFlow = { categoryId:null, mainItemId:null, freeItemId:null, qty:null, date:null, invoiceNumber:'', submitted:false, dateEditing:false };
let pendingInvoiceFile = null;
let pendingInvoicePreview = null;
let lastSubmittedSale = null;

// سجل المبيعات (بعد الإرسال ما في تعديل ولا حذف — الأدمن بيقبل أو بيرفض، ولو غلطت بترسل عملية جديدة)
let mySalesCache = null;

// فلتر تبويب "السجل" — Pills فوق القائمة (بدل شاشة اختيار منفصلة)، وبيتذكر آخر اختيار خلال الجلسة
// نوع الفاتورة: 'ALL' (بالكوزمتك بس) / 'NORMAL' / 'ASIL' / 'ZAROZA' — بقسم الأدوية دايمًا 'NORMAL'
let historyFilterType = 'ALL';
// حالة الفاتورة: 'ALL' / 'APPROVED' / 'PENDING' / 'REJECTED'
let historyStatusFilter = 'ALL';
// إظهار/إخفاء ملخص القطع الفري المستحقة (لصفحات التعويض فقط)
let showFreeItemsSummary = false;
// عنوان الفلتر يتغيّر حسب القسم الحالي (فواتير الدواء / فواتير الكوزمتك بدل "المبيعات العادية")
function historyFilterLabel(v){
  if(v==='ALL') return 'كل الفواتير';
  if(v==='NORMAL') return selectedDepartment==='MEDICINE' ? 'فواتير الدواء' : 'فواتير الكوزمتك';
  if(v==='ASIL') return 'فواتير تعويض الأصيل';
  if(v==='ZAROZA') return 'فواتير تعويض زاروزا';
  return '';
}
// Pills نوع الفاتورة تظهر فقط بالكوزمتك (3 أنواع + الكل) — الأدوية عندها نوع واحد فما في داعي لإظهارها أصلًا
function historyTypePills(){
  if(selectedDepartment==='MEDICINE') return [];
  return [
    { value:'ALL',    label:'الكل' },
    { value:'NORMAL', label:'عادية' },
    { value:'ASIL',   label:'تعويض الأصيل' },
    { value:'ZAROZA', label:'تعويض زاروزا' },
  ];
}
const HISTORY_STATUS_PILLS = [
  { value:'ALL',      label:'الكل' },
  { value:'APPROVED', label:'مقبولة' },
  { value:'PENDING',  label:'قيد المراجعة' },
  { value:'REJECTED', label:'مرفوضة' },
];
// عناوين فواصل التاريخ ("اليوم" / "أمس" / "أيلول ٢٠٢٦"...) بناءً على تاريخ رفع الفاتورة
function historyDateGroupLabel(dateVal){
  const d = new Date(dateVal);
  const now = new Date();
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if(diffDays===0) return 'اليوم';
  if(diffDays===1) return 'أمس';
  if(d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth()) return fmtMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));
  return fmtMonth(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));
}

// الأدمن
let adminSalesCache = null; // كل عمليات القسم (كل الحالات)
let rejectingId = null;
let adminPharmacistFilter = null; // مراجعة فواتير صيدلي محدد (قادم من صفحة الدفعات)

let pharmacistsCache = null; // GET /users/pharmacists

// تبويب "إدارة الأصناف" عند الأدمن: تبويب فرعي حالي (فقط لقسم الكوزمتك)
// 'NORMAL' = الأصناف العادية / 'ASIL' / 'ZAROZA' = أصناف التعويض
let catMgmtSubTab = 'NORMAL';
// تعديل صنف موجود: أي صنف حاليًا بوضع التعديل (id)
let editingCategoryId = null;

// تبويب الإحالة
let referralSummaryCache = null;


function defaultAdminFilter(){
  return { city:'', pharmacistId:'', pharmacistName:'', fromDate:toLocalDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), toDate:toLocalDateStr(new Date()) };
}
let adminFilter = defaultAdminFilter();
let adminFilterActive = false;
let reportsRows = [];

// تقارير تعويض الأصيل/زاروزا (أدمن الكوزمتك فقط) — فلتر مستقل لكل نوع
function defaultCompFilter(){
  return { city:'', pharmacistId:'', pharmacistName:'', fromDate:toLocalDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), toDate:toLocalDateStr(new Date()) };
}
let compReportsFilter = { ASIL: defaultCompFilter(), ZAROZA: defaultCompFilter() };
let compReportsRows = { ASIL: null, ZAROZA: null };
let compReportsActive = { ASIL:false, ZAROZA:false };

// رسائل جماعية (SMS) — فلتر المناطق يُدمج مع فلتر الصيدليات المحددة يدويًا (OR)
function defaultMessagesState(){
  return { cities:[], pharmacistIds:[], allPharmacists:false, pharmacistSearch:'' };
}
let messagesState = defaultMessagesState();
let messagesCampaignsCache = null;   // GET /messages/campaigns
let messagesCampaignDetailCache = {}; // id -> تفاصيل الحملة (تُحمّل عند الطلب فقط)
let messagesExpandedCampaignId = null;
let messagesPendingSend = null;      // لقطة من المحتوى + مرحلة الاعتماد: stage='review' ثم 'code'
let messagesDraft = { name:'', text:'' }; // مسودة الرسالة (بتنحفظ مع كل ضغطة حرف عشان render() ما يمسحها)
let messagesSending = false;
let messagesLastResult = null;       // نتيجة آخر حملة أُرسلت (للعرض فوق السجل مباشرة)

// الأدمن داخل لوحة الكوزمتك — تظهر له تبويبات تعويض الأصيل/زاروزا
function isCosmeticsAdminContext(){
  if(currentUser?.type!=='admin') return false;
  return adminDeptFilter === 'COSMETICS';
}

let statsFilter = { city:'' };
let statsFilterActive = false;

// الدفعات الشهرية (أدمن)
let payoutsData = null;        // رد GET /payouts
let referralAdminData = null;  // رد GET /referral/admin/summary
let confirmingReferralId = null; // معرف الصيدلي اللي بنأكد تحويل إحالته حاليًا
let referralHistoryData = null;  // رد GET /referral/admin/history
let payoutsScope = 'live';     // 'live' = كل المستحق حاليًا | 'last_month' = الشهر التقويمي اللي فات
let previousDuesCache = null;  // رد GET /payouts/me (تبويب الصيدلي: التحويلات السابقة)
let payoutsHistoryData = null; // رد GET /payouts/history (تبويب الأدمن: الدفعات الشهرية السابقة)
let payoutsHistoryFilter = { city:'', search:'' };
let payoutsHistoryFilterActive = false;
let confirmingPayoutId = null; // الصيدلي اللي بنأكد تحويله حاليًا
let accountMsg = null;         // رسالة تبويب الحساب (تغيير كلمة السر)


/* ---------------- API helper ---------------- */
function apiErrorMessage(data, status){
  if(Array.isArray(data?.details) && data.details.length){
    return data.details.map(d => d.message).join(' — ');
  }
  return data?.message ? data.message : ('حدث خطأ (كود ' + status + ')');
}

async function apiRequest(path, { method='GET', json=null, form=null, auth=true } = {}){
  const headers = {};
  let body;
  if(form){ body = form; }
  else if(json){ headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }

  let res;
  try{
    // credentials:'include' إلزامي حتى يرسل المتصفح كوكي الجلسة (httpOnly) مع الطلب —
    // بدونها الطلب بيروح بدون أي إثبات هوية حتى لو المستخدم مسجّل دخول فعليًا
    res = await fetch(API_BASE + path, { method, headers, body, credentials:'include' });
  }catch(e){
    // فشل الاتصال نفسه (شبكة/CORS/سيرفر واقف): نص الخطأ التقني ما بيفيد المستخدم، فبنرمي رسالة عربية واضحة بدله
    showConnBanner(true);
    throw new Error('تعذر الاتصال بالسيرفر. تأكد من تشغيل الباك-إند وصحة عنوان API_BASE.');
  }
  showConnBanner(false);

  let data = {};
  try{ data = await res.json(); }catch(e){ /* رد بدون JSON */ }

  if(!res.ok){
    const err = new Error(apiErrorMessage(data, res.status));
    err.details = data?.details;
    err.code = data?.code;
    err.status = res.status;
    if(res.status === 401 && auth && currentUser){ handleUnauthorized(); }
    throw err;
  }
  return data; // { success, message, data }
}

function showConnBanner(show){
  const el = document.getElementById('connBanner');
  if(!el) return;
  if(show){
    el.textContent = 'تعذر الاتصال بسيرفر الباك-إند (' + API_BASE + ') — تأكد إنه شغّال';
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function handleUnauthorized(){
  // الكوكي نفسها خلص عمرها أو انرفضت من السيرفر (401) — ما في شي نمسحه يدويًا من
  // جافاسكربت (httpOnly)، بس نصفّر حالة الواجهة المحلية
  currentUser = null;
  currentScreen = 'login';
  toast('انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مجددًا', 'danger');
  render();
}

/* ---------------- utils ---------------- */
function toast(msg, kind){
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (kind==='danger' ? ' danger' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>{ el.remove(); }, 3200);
}
function esc(value){
  if(value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function fmtMoney(n){ return Number(n||0).toFixed(3); }
function fmtMonth(key){
  if(!key) return '';
  const [y,m] = key.split('-').map(Number);
  const names = ['كانون الثاني','شباط','آذار','نيسان','أيار','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'];
  return names[m-1] + ' ' + y;
}
function currentMonthKey(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function shiftMonthKey(key, delta){
  const [y,m] = key.split('-').map(Number);
  const idx = y*12 + (m-1) + delta;
  return Math.floor(idx/12)+'-'+String((idx%12)+1).padStart(2,'0');
}
function fmtDate(d){
  if(!d) return '';
  // ما في try/catch: new Date() و toLocaleDateString() ما بيرموا استثناء لقيم JSON (نص/رقم)،
  // والتاريخ غير الصالح بيرجع النص "Invalid Date" بدون ما ينكسر الجدول
  const dt = d.length===10 ? new Date(d+'T00:00:00') : new Date(d);
  return dt.toLocaleDateString('ar-EG',{year:'numeric',month:'short',day:'numeric'});
}
function toDateInputValue(d){
  if(!d) return '';
  return String(d).slice(0,10);
}
function statusBadgeHtml(s){
  if(s.status==='APPROVED') return `<span class="badge ok">مقبولة</span>`;
  if(s.status==='REJECTED') return `<span class="badge rejected">مرفوضة</span>`;
  return `<span class="badge pending">قيد المراجعة</span>`;
}
// اسم ملف تحميل صورة الفاتورة (نفس الصيغة المستخدمة سابقًا بكل المواضع)
function invoiceFileName(s){
  return `فاتورة-${s.id}.jpg`;
}
function invoiceViewButtonHtml(s){
  if(!s.invoiceImageUrl) return '—';
  return `<button class="view-invoice-btn" data-click="openImageModal" ${DA('click', String(s.invoiceImageUrl), invoiceFileName(s))}>🔍 عرض</button>`;
}
function payoutTypeLabel(t){
  if(t==='PHONE') return 'رقم هاتف';
  if(t==='ALIAS') return 'اسم مستعار';
  return '—';
}

function resizeImageToBlob(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1000;
        const scale = Math.min(1, maxW/img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width*scale));
        canvas.height = Math.max(1, Math.round(img.height*scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        canvas.toBlob(blob=>{
          if(!blob){ reject(new Error('تعذرت معالجة الصورة')); return; }
          resolve({ blob, dataUrl: canvas.toDataURL('image/jpeg', 0.8) });
        }, 'image/jpeg', 0.8);
      };
      img.onerror = () => reject(new Error('تعذرت قراءة الصورة'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('تعذرت قراءة الصورة'));
    reader.readAsDataURL(file);
  });
}

function openImageModal(src, filename){
  document.getElementById('imgModalImg').src = src;
  const dl = document.getElementById('imgModalDownload');
  dl.href = src;
  dl.download = filename || 'فاتورة.jpg';
  document.getElementById('imgModal').classList.remove('hidden');
}
function openCompareImageModal(srcA, srcB, similarity){
  document.getElementById('compareImgA').src = srcA;
  document.getElementById('compareImgB').src = srcB;
  document.getElementById('compareImgTitle').textContent = `نسبة التشابه البصري: ${similarity}%`;
  document.getElementById('compareImgModal').classList.remove('hidden');
}
function closeCompareImageModal(){
  document.getElementById('compareImgModal').classList.add('hidden');
  document.getElementById('compareImgA').src = '';
  document.getElementById('compareImgB').src = '';
}
function closeImageModal(){
  document.getElementById('imgModal').classList.add('hidden');
  document.getElementById('imgModalImg').src = '';
}

// الخلفية الداكنة للـ modal مجرد backdrop (مش عنصر تفاعلي): الضغط عليها بيسكّر،
// والمستخدم بالكيبورد عنده زر "إغلاق" + مفتاح Escape.
function bindModalBackdrop(modalId, closeFn){
  const overlay = document.getElementById(modalId);
  overlay.addEventListener('click', e => { if(e.target === overlay) closeFn(); });
}
bindModalBackdrop('imgModal', closeImageModal);
bindModalBackdrop('compareImgModal', closeCompareImageModal);
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(!document.getElementById('compareImgModal').classList.contains('hidden')) { closeCompareImageModal(); }
  if(!document.getElementById('imgModal').classList.contains('hidden')) closeImageModal();
});

/* ---------------- render root ---------------- */
function render(){
  const app = document.getElementById('app');
  if(!currentUser){
    app.innerHTML = screens[currentScreen] ? screens[currentScreen]() : screenLanding();
  } else if(currentUser.type==='admin' && !adminPanelChosen){
    app.innerHTML = screenAdminPanelChoice();
  } else if(currentUser.type==='pharmacist' && !selectedDepartment){
    app.innerHTML = screenDeptChoice();
  } else if(currentUser.type==='pharmacist' && selectedDepartment==='COSMETICS' && !saleMode){
    app.innerHTML = screenCosmeticsChoice();
  } else {
    app.innerHTML = screenAppShell();
  }
}
function goto(screen){ currentScreen = screen; render(); }

/* ============================================================
   شاشات ما قبل تسجيل الدخول
   ============================================================ */
function topLogoBar(){
  return `
  <div class="sx-8">
    <div class="sx-9">م</div>
    <div class="sx-10">مستودع مسروجي</div>
  </div>`;
}

function screenLanding(){
  return `
  <div class="center-wrap">
    <div class="card">
      <div class="brand">
        <div class="brand-mark">م</div>
        <div class="brand-text">
          <div class="t1">مستودع مسروجي</div>
          <div class="t2">نظام عمولات المبيعات</div>
        </div>
      </div>
      <p class="sx-11">
        سجّل مبيعاتك من الصيدلية بسهولة، واحصل على عمولتك فورًا لكل عملية بيع.
      </p>
      <button class="btn" data-click="goto" data-click-args="[&quot;login&quot;]">تسجيل الدخول</button>
      <div class="divider">أو</div>
      <button class="btn ghost" data-click="goto" data-click-args="[&quot;reg1&quot;]">إنشاء حساب جديد</button>
    </div>
  </div>`;
}

function screenDeptChoice(){
  return `
  ${topLogoBar()}
  <div class="center-wrap">
    <div class="card">
      <h2 class="sx-12">أهلًا ${esc(currentUser.fullName)} 👋</h2>
      <p class="sx-13">اختر القسم اللي بدك تسجل فيه عملية بيع</p>
      ${DEPARTMENTS.map(d=>`
        <button class="btn ${d.value==='MEDICINE'?'':'accent'} sx-14" data-click="chooseDepartment" ${DA('click', String(d.value))}>
          ${d.icon} تسجيل عملية بيع ${d.label}
        </button>`).join('')}
      <div class="sx-15">
        <button class="link-btn" data-click="doLogout">تسجيل الخروج</button>
      </div>
    </div>
  </div>`;
}

// الأدمن: أول شاشة بعد الدخول — اختيار لوحة التحكم (أدوية / كوزمتك)
function screenAdminPanelChoice(){
  return `
  ${topLogoBar()}
  <div class="center-wrap">
    <div class="card">
      <h2 class="sx-12">أهلًا ${esc(currentUser.fullName)} 👋</h2>
      <p class="sx-13">اختر لوحة التحكم اللي بدك تدخل عليها</p>
      ${DEPARTMENTS.map(d=>`
        <button class="btn ${d.value==='MEDICINE'?'':'accent'} sx-14" data-click="chooseAdminPanel" ${DA('click', String(d.value))}>
          ${d.icon} الدخول إلى لوحة تحكم ${d.label}
        </button>`).join('')}
      <div class="sx-15">
        <button class="link-btn" data-click="doLogout">تسجيل الخروج</button>
      </div>
    </div>
  </div>`;
}

async function chooseAdminPanel(dep){
  adminDeptFilter = dep;
  adminPanelChosen = true;
  adminSalesCache = null; CATEGORIES = [];
  compensationItemsCache = { ASIL:null, ZAROZA:null }; catMgmtSubTab = 'NORMAL';
  adminFilterActive = false; reportsRows = [];
  compReportsFilter = { ASIL: defaultCompFilter(), ZAROZA: defaultCompFilter() };
  compReportsRows = { ASIL: null, ZAROZA: null }; compReportsActive = { ASIL:false, ZAROZA:false };
  activeTab = 'admin';
  render();
  await loadTabData(activeTab);
}

function switchAdminPanel(){
  adminPanelChosen = false;
  render();
}

async function chooseDepartment(dep){
  selectedDepartment = dep;
  activeTab = 'add';
  resetAddFlow();
  CATEGORIES = [];
  compensationItemsCache = { ASIL:null, ZAROZA:null };
  if(dep === 'COSMETICS'){
    saleMode = null;
    render();
  } else {
    saleMode = 'NORMAL';
    render();
    await loadTabData(activeTab);
  }
}

function switchDepartment(){
  selectedDepartment = null;
  saleMode = null;
  CATEGORIES = []; mySalesCache = null;
  historyFilterType = 'ALL'; historyStatusFilter = 'ALL'; showFreeItemsSummary = false;
  compensationItemsCache = { ASIL:null, ZAROZA:null };
  render();
}

function screenCosmeticsChoice(){
  return `
  ${topLogoBar()}
  <div class="center-wrap">
    <div class="card">
      <div class="back-row"><button data-click="switchDepartment">‹ رجوع</button></div>
      <h2 class="sx-12">قسم الكوزمتك 💄</h2>
      <p class="sx-13">اختر نوع العملية اللي بدك تسجلها</p>
      ${SALE_MODES.map(m=>`
        <button class="btn ${m.value==='NORMAL'?'':'accent'} sx-16" data-click="chooseSaleMode" ${DA('click', String(m.value))}>
          ${m.icon} ${m.label}
        </button>`).join('')}
      <div class="sx-15">
        <button class="link-btn" data-click="doLogout">تسجيل الخروج</button>
      </div>
    </div>
  </div>`;
}

async function chooseSaleMode(mode){
  saleMode = mode;
  activeTab = 'add';
  resetAddFlow();
  render();
  await loadTabData(activeTab);
}

function switchSaleMode(){
  saleMode = null;
  activeTab = 'add';
  resetAddFlow();
  render();
}

function resetAddFlow(){
  addFlow = { categoryId:null, mainItemId:null, freeItemId:null, qty:null, date:null, invoiceNumber:'', submitted:false, dateEditing:false };
  pendingInvoiceFile = null; pendingInvoicePreview = null; lastSubmittedSale = null;
}

function screenLogin(){
  return `
  ${topLogoBar()}
  <div class="center-wrap">
    <div class="card">
      <div class="back-row"><button data-click="goto" data-click-args="[&quot;landing&quot;]">‹ رجوع</button></div>
      <h2 class="sx-12">تسجيل الدخول</h2>
      <p class="sx-17">أدخل رقم هاتفك وكلمة المرور (الإدارة: اسم المستخدم)</p>

      <div class="field">
        <label>رقم الهاتف</label>
        <input type="text" id="loginPhone" placeholder="07XXXXXXXX" inputmode="numeric">
      </div>
      <div class="field">
        <label>كلمة المرور</label>
        <input type="password" id="loginPass" placeholder="••••••••">
      </div>
      <button class="btn" id="loginBtn" data-click="doLogin">دخول</button>
      <div class="sx-18">
        <button class="link-btn" data-click="resetForgotThenGoto" data-click-args="[&quot;forgot&quot;]">نسيت كلمة المرور؟</button>
        <button class="link-btn" data-click="goto" data-click-args="[&quot;reg1&quot;]">ليس لديك حساب؟ إنشاء حساب جديد</button>
      </div>
    </div>
  </div>`;
}

function screenForgot(){
  const f = forgot;
  const dev = f.devCode ? `<div class="otp-banner"><span>وضع التطوير — رمز التحقق</span><span class="code">${esc(f.devCode)}</span></div>` : '';
  let body = '';
  if(f.step === 1){
    body = `
      <p class="sx-19">أدخل رقم هاتفك المسجّل وسنرسل لك رمز تحقق على هاتفك.</p>
      <div class="field">
        <label>رقم الهاتف</label>
        <input type="tel" id="forgotPhone" maxlength="10" inputmode="numeric" placeholder="07XXXXXXXX" value="${esc(f.phone)}">
      </div>
      <button class="btn" id="forgotSendBtn" data-click="forgotSendOtp">إرسال رمز التحقق</button>`;
  } else if(f.step === 2){
    body = `
      <p class="sx-19">أرسلنا رمزًا مكوّنًا من 6 أرقام إلى <b class="num">${esc(f.phone)}</b>.</p>
      ${dev}
      <div class="field">
        <label>رمز التحقق</label>
        <input type="text" id="forgotCode" maxlength="6" inputmode="numeric" placeholder="XXXXXX">
      </div>
      <button class="btn" id="forgotVerifyBtn" data-click="forgotVerifyOtp">تأكيد الرمز</button>
      <div class="sx-20"><button class="link-btn" data-click="forgotSendOtp" data-click-args="[true]">إعادة إرسال الرمز</button></div>`;
  } else {
    body = `
      <p class="sx-19">تم التحقق ✓ — أدخل كلمة المرور الجديدة.</p>
      <div class="field">
        <label>كلمة المرور الجديدة</label>
        <input type="password" id="forgotNewPass" placeholder="8 أحرف على الأقل، فيها حرف ورقم">
      </div>
      <div class="field">
        <label>تأكيد كلمة المرور</label>
        <input type="password" id="forgotNewPass2" placeholder="أعد كتابة كلمة المرور">
      </div>
      <button class="btn" id="forgotResetBtn" data-click="forgotReset">حفظ كلمة المرور</button>`;
  }
  return `
  ${topLogoBar()}
  <div class="center-wrap">
    <div class="card">
      <div class="back-row"><button data-click="resetForgotThenGoto" data-click-args="[&quot;login&quot;]">‹ رجوع</button></div>
      <h2 class="sx-12">استعادة كلمة المرور</h2>
      <p class="sx-21">الخطوة ${f.step} من 3</p>
      ${body}
    </div>
  </div>`;
}

function resetForgot(){ forgot = { step:1, phone:'', resetToken:null, devCode:null }; }

function startForgotFromReg(){
  const phone = pendingReg.phone || '';
  resetReg();
  forgot = { step:1, phone, resetToken:null, devCode:null };
  goto('forgot');
}

async function forgotSendOtp(isResend){
  const phone = isResend ? forgot.phone : document.getElementById('forgotPhone').value.trim();
  if(!/^\d{10}$/.test(phone)){ toast('رقم الهاتف يجب أن يتكون من 10 أرقام', 'danger'); return; }
  const btn = document.getElementById('forgotSendBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ الإرسال...'; }
  try{
    const res = await apiRequest('/auth/pharmacist/forgot-password/send-otp', { method:'POST', auth:false, json:{ phoneNumber: phone } });
    forgot.phone = phone;
    forgot.devCode = res.data?.devOtpCode ? res.data.devOtpCode : null;
    forgot.step = 2;
    toast('تم إرسال رمز التحقق إلى ' + phone);
    render();
  }catch(e){
    toast(e.message, 'danger');
    if(btn){ btn.disabled = false; btn.textContent = 'إرسال رمز التحقق'; }
  }
}

async function forgotVerifyOtp(){
  const code = document.getElementById('forgotCode').value.trim();
  if(!/^\d{6}$/.test(code)){ toast('رمز التحقق مكوّن من 6 أرقام', 'danger'); return; }
  const btn = document.getElementById('forgotVerifyBtn');
  if(btn) { btn.disabled = true; }
  try{
    const res = await apiRequest('/auth/pharmacist/forgot-password/verify-otp', { method:'POST', auth:false, json:{ phoneNumber: forgot.phone, code } });
    forgot.resetToken = res.data.resetToken;
    forgot.step = 3;
    render();
  }catch(e){
    toast(e.message, 'danger');
    if(btn) btn.disabled = false;
  }
}

async function forgotReset(){
  const p1 = document.getElementById('forgotNewPass').value;
  const p2 = document.getElementById('forgotNewPass2').value;
  if(p1.length < 8 || !/[A-Za-z\u0621-\u064A]/.test(p1) || !/\d/.test(p1)){ toast('كلمة المرور يجب أن تكون 8 أحرف على الأقل وفيها حرف ورقم', 'danger'); return; }
  if(p1 !== p2){ toast('كلمتا المرور غير متطابقتين', 'danger'); return; }
  const btn = document.getElementById('forgotResetBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ الحفظ...'; }
  try{
    await apiRequest('/auth/pharmacist/forgot-password/reset', { method:'POST', auth:false, json:{ resetToken: forgot.resetToken, newPassword: p1 } });
    toast('تم تغيير كلمة المرور بنجاح ✓ سجّل الدخول الآن');
    resetForgot();
    goto('login');
  }catch(e){
    toast(e.message, 'danger');
    if(btn){ btn.disabled = false; btn.textContent = 'حفظ كلمة المرور'; }
  }
}

function screenReg1(){
  const step1Done = pendingReg.name && pendingReg.phone && otpVerified;
  const otpBannerHtml = otpCode ? `<div class="otp-banner"><span>وضع التطوير — رمز التحقق</span><span class="code">${esc(otpCode)}</span></div>` : '';
  return `
  ${topLogoBar()}
  <div class="center-wrap">
    <div class="card">
      <div class="back-row"><button data-click="resetRegThenGoto" data-click-args="[&quot;landing&quot;]">‹ رجوع</button></div>
      <h2 class="sx-12">حساب جديد</h2>
      <p class="sx-17">الخطوة 1 من 2 — بيانات التواصل</p>

      <div class="field">
        <label>الاسم الكامل</label>
        <input type="text" id="regName" placeholder="مثال: أحمد الشريف" value="${esc(pendingReg.name||'')}">
      </div>

      <div class="field">
        <label>رقم الهاتف</label>
        <div class="row2">
          <input type="tel" id="regPhone" maxlength="10" placeholder="10 أرقام" inputmode="numeric" value="${pendingReg.phone||''}" ${otpVerified?'disabled':''}>
          <button class="btn accent sm sx-22" id="sendOtpBtn" data-click="sendOtp" ${otpVerified?'disabled':''}>إرسال رمز التحقق</button>
        </div>
        <div class="hint">يجب أن يتكون رقم الهاتف من 10 أرقام بالضبط</div>
      </div>

      ${regPhoneExists ? `
      <div class="otp-banner sx-23">
        <div class="sx-24">حسابك مسجّل مسبقًا بهذا الرقم. سجّل الدخول، أو اضغط على استعادة كلمة المرور إذا نسيتها.</div>
        <div class="sx-25">
          <button class="btn sm sx-26" data-click="resetRegThenGoto" data-click-args="[&quot;login&quot;]">تسجيل الدخول</button>
          <button class="btn accent sm sx-26" data-click="startForgotFromReg">استعادة كلمة المرور</button>
        </div>
      </div>` : ''}

      ${otpSent && !otpVerified ? `
      ${otpBannerHtml}
      <div class="field">
        <label>أدخل رمز التحقق (6 أرقام)</label>
        <div class="row2">
          <input type="text" id="otpInput" maxlength="6" placeholder="XXXXXX" inputmode="numeric">
          <button class="btn sm sx-22" id="verifyOtpBtn" data-click="verifyOtp">تأكيد</button>
        </div>
      </div>` : ''}

      ${otpVerified ? `<div class="sx-27"><span class="badge ok">✓ تم تأكيد رقم الهاتف</span></div>` : ''}

      <button class="btn" ${step1Done ? '' : 'disabled'} data-click="goStep2">التالي</button>
    </div>
  </div>`;
}

function resetReg(){ pendingReg = {}; otpCode=null; otpVerified=false; verificationToken=null; regPhoneExists=false; otpSent=false; }

async function sendOtp(){
  const name = document.getElementById('regName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  if(!name){ toast('الرجاء إدخال الاسم', 'danger'); return; }
  if(!/^\d{10}$/.test(phone)){ toast('رقم الهاتف يجب أن يتكون من 10 أرقام', 'danger'); return; }

  const btn = document.getElementById('sendOtpBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ الإرسال...'; }
  try{
    const res = await apiRequest('/auth/pharmacist/send-otp', { method:'POST', auth:false, json:{ fullName:name, phoneNumber:phone } });
    pendingReg.name = name;
    pendingReg.phone = phone;
    otpCode = res.data?.devOtpCode ? res.data.devOtpCode : null;
    otpVerified = false;
    regPhoneExists = false;
    otpSent = true;
    toast('تم إرسال رمز التحقق إلى ' + phone);
    render();
  }catch(e){
    if(e.code === 'PHONE_EXISTS'){
      pendingReg.name = name; pendingReg.phone = phone;
      regPhoneExists = true; otpSent = false; otpCode = null;
      render();
      return;
    }
    toast(e.message, 'danger');
    if(btn){ btn.disabled = false; btn.textContent = 'إرسال رمز التحقق'; }
  }
}

async function verifyOtp(){
  const val = document.getElementById('otpInput').value.trim();
  if(!/^\d{6}$/.test(val)){ toast('رمز التحقق مكوّن من 6 أرقام', 'danger'); return; }
  const btn = document.getElementById('verifyOtpBtn');
  if(btn) { btn.disabled = true; }
  try{
    const res = await apiRequest('/auth/pharmacist/verify-otp', { method:'POST', auth:false, json:{ phoneNumber: pendingReg.phone, code: val } });
    verificationToken = res.data.verificationToken;
    otpVerified = true;
    toast('تم تأكيد رقم الهاتف ✓');
    render();
  }catch(e){
    toast(e.message, 'danger');
    if(btn) btn.disabled = false;
  }
}

function goStep2(){
  if(!otpVerified){ toast('الرجاء تأكيد رقم الهاتف أولاً', 'danger'); return; }
  goto('reg2');
}

function screenReg2(){
  return `
  ${topLogoBar()}
  <div class="center-wrap">
    <div class="card">
      <div class="back-row"><button data-click="goto" data-click-args="[&quot;reg1&quot;]">‹ رجوع</button></div>
      <h2 class="sx-12">حساب جديد</h2>
      <p class="sx-17">الخطوة 2 من 2 — بيانات الصيدلية</p>

      <div class="field">
        <label>كلمة المرور</label>
        <input type="password" id="regPass" placeholder="8 أحرف على الأقل، فيها حرف ورقم">
      </div>
      <div class="field">
        <label>اسم الصيدلية</label>
        <input type="text" id="regPharmacy" placeholder="مثال: صيدلية الشفاء">
      </div>
      <div class="field">
        <label>المدينة</label>
        <select id="regCity">
          <option value="" disabled selected>اختر المدينة</option>
          ${JORDAN_CITIES.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>المنطقة / الحي</label>
        <input type="text" id="regRegion" placeholder="مثال: الجبيهة">
      </div>
      <div class="field">
        <label>كود الإحالة (اختياري)</label>
        <input type="text" id="regReferralCode" placeholder="إذا أحالك صيدلي آخر، اكتب كوده هنا" value="${esc(incomingReferralCode || '')}" maxlength="12" class="sx-28">
      </div>

      <div class="field sx-29">
        <input type="checkbox" id="agreeTerms" class="sx-30">
        <label for="agreeTerms" class="sx-31">
          أوافق على <b class="sx-32">الشروط والأحكام</b> و<b class="sx-32">سياسة الخصوصية</b>،
          وأفهم أن بياناتي (الاسم، الهاتف، صور الفواتير) تُستخدم فقط لغايات إدارة نظام العمولات مع شركة مستودع مسروجي.
        </label>
      </div>

      <button class="btn" id="createAccBtn" data-click="createAccount">إنشاء الحساب</button>
    </div>
  </div>`;
}

async function createAccount(){
  const password = document.getElementById('regPass').value;
  const pharmacyName = document.getElementById('regPharmacy').value.trim();
  const city = document.getElementById('regCity').value;
  const region = document.getElementById('regRegion').value.trim();
  const referralCodeInput = document.getElementById('regReferralCode');
  const referralCode = referralCodeInput ? referralCodeInput.value.trim() : '';
  const agreed = document.getElementById('agreeTerms').checked;
  if(password.length < 8 || !/[A-Za-z\u0621-\u064A]/.test(password) || !/\d/.test(password)){ toast('كلمة المرور يجب أن تكون 8 أحرف على الأقل وفيها حرف ورقم', 'danger'); return; }
  if(!pharmacyName || !city || !region){ toast('الرجاء تعبئة جميع الحقول', 'danger'); return; }
  if(!agreed){ toast('الرجاء الموافقة على الشروط والأحكام وسياسة الخصوصية', 'danger'); return; }
  if(!verificationToken){ toast('الرجاء تأكيد رقم الهاتف أولاً', 'danger'); goto('reg1'); return; }

  const btn = document.getElementById('createAccBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ الإنشاء...'; }
  try{
    await apiRequest('/auth/pharmacist/register', { method:'POST', auth:false, json:{
      verificationToken,
      fullName: pendingReg.name,
      phoneNumber: pendingReg.phone,
      password,
      pharmacyName, city, region, agreedTerms:true,
      ...(referralCode ? { referralCode } : {})
    }});
    toast('تم إنشاء الحساب بنجاح ✓');
    await afterAuthSuccess();
    resetReg();
  }catch(e){
    toast(e.message, 'danger');
    if(btn){ btn.disabled = false; btn.textContent = 'إنشاء الحساب'; }
  }
}

function screen2fa(){
  const dev = admin2fa.devCode ? `<div class="otp-banner"><span>وضع التطوير — رمز التحقق</span><span class="code">${esc(admin2fa.devCode)}</span></div>` : '';
  return `
  ${topLogoBar()}
  <div class="center-wrap">
    <div class="card">
      <div class="back-row"><button data-click="resetAdmin2faThenLogin">‹ رجوع</button></div>
      <h2 class="sx-12">التحقق بخطوتين</h2>
      <p class="sx-19">أرسلنا رمز تحقق إلى الهاتف <b class="num">${esc(admin2fa.maskedPhone)}</b>. أدخله لإكمال الدخول.</p>
      ${dev}
      <div class="field">
        <label>رمز التحقق</label>
        <input type="text" id="admin2faCode" maxlength="6" inputmode="numeric" placeholder="XXXXXX">
      </div>
      <button class="btn" id="admin2faBtn" data-click="verifyAdmin2fa">تأكيد ودخول</button>
    </div>
  </div>`;
}

async function verifyAdmin2fa(){
  const code = document.getElementById('admin2faCode').value.trim();
  if(!/^\d{6}$/.test(code)){ toast('رمز التحقق مكوّن من 6 أرقام', 'danger'); return; }
  const btn = document.getElementById('admin2faBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ التحقق...'; }
  try{
    await apiRequest('/auth/admin/verify-2fa', { method:'POST', auth:false, json:{ challengeToken: admin2fa.challengeToken, code } });
    admin2fa = { challengeToken:null, maskedPhone:'', devCode:null };
    await afterAuthSuccess();
  }catch(e){
    toast(e.message, 'danger');
    if(btn){ btn.disabled = false; btn.textContent = 'تأكيد ودخول'; }
  }
}

const screens = { landing: screenLanding, login: screenLogin, forgot: screenForgot, reg1: screenReg1, reg2: screenReg2, twofa: screen2fa };

/* ============================================================
   تسجيل الدخول
   ============================================================ */
async function doLogin(){
  const idValue = document.getElementById('loginPhone').value.trim();
  const pass = document.getElementById('loginPass').value;
  if(!pass){ toast('الرجاء إدخال كلمة المرور', 'danger'); return; }

  const looksNumeric = /^\d+$/.test(idValue);
  if(looksNumeric && idValue.length !== 10){
    toast('رقم الهاتف يجب أن يتكون من 10 أرقام', 'danger');
    return;
  }
  const isAdminAttempt = !(looksNumeric && idValue.length === 10);
  if(isAdminAttempt && idValue.length < 2){
    toast('الرجاء إدخال رقم الهاتف أو اسم المستخدم', 'danger');
    return;
  }

  const btn = document.getElementById('loginBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ الدخول...'; }
  try{
    const res = isAdminAttempt
      ? await apiRequest('/auth/admin/login', { method:'POST', auth:false, json:{ username: idValue, password: pass } })
      : await apiRequest('/auth/pharmacist/login', { method:'POST', auth:false, json:{ phoneNumber: idValue, password: pass } });
    if(res.data?.requires2fa){
      admin2fa = { challengeToken: res.data.challengeToken, maskedPhone: res.data.maskedPhone || '', devCode: res.data.devOtpCode || null };
      goto('twofa');
      return;
    }
    await afterAuthSuccess();
  }catch(e){
    toast(e.message, 'danger');
    if(btn){ btn.disabled = false; btn.textContent = 'دخول'; }
  }
}

async function afterAuthSuccess(){
  // الكوكي (httpOnly) انحطت تلقائيًا من المتصفح لحظة استجابة تسجيل الدخول — ما في
  // شي نخزّنه يدويًا هون، بس نجيب بيانات المستخدم بالجلسة الجديدة
  await loadMe();
  clearAllCaches();
  resetAddFlow();
  toast('مرحبًا ' + currentUser.fullName + ' 👋');
  if(currentUser.type === 'admin'){
    adminPanelChosen = false; adminDeptFilter = '';
    activeTab = 'admin';
    render();
  } else {
    render();
  }
}

async function loadMe(){
  const res = await apiRequest('/users/me');
  currentUser = res.data;
  if(currentUser.type === 'admin') currentUser.role = 'SUPER_ADMIN';
}

async function doLogout(){
  // لازم نطلب من السيرفر يمسح كوكي الجلسة (httpOnly) — جافاسكربت ما بيقدر يمسحها بنفسه.
  // بنصفّر حالة الواجهة بكل الأحوال حتى لو الطلب فشل (مثلاً انقطع الاتصال)، عشان
  // المستخدم يحس إنه خرج فورًا من واجهته، والكوكي القديمة أصلًا رح تنتهي صلاحيتها
  // لحالها لاحقًا حتى لو ما انمسحت فعليًا بسبب فشل الطلب.
  try{ await apiRequest('/auth/logout', { method:'POST', auth:false }); }catch(e){ /* نكمل تسجيل الخروج محليًا بكل الأحوال */ }
  currentUser = null;
  selectedDepartment = null; adminDeptFilter = ''; adminPanelChosen = false; saleMode = null;
  resetReg(); resetForgot(); payoutDraft = null; payoutOtpSent = false; payoutOtpDev = null; payoutIntroAcked = false;
  payoutEditUnlocked = false; payoutEditOtpSent = false; payoutEditOtpDev = null; payoutEditCode = '';
  clearAllCaches();
  goto('landing');
}

function clearAllCaches(){
  CATEGORIES = []; mySalesCache = null; adminSalesCache = null; pharmacistsCache = null;
  historyFilterType = 'ALL'; historyStatusFilter = 'ALL'; showFreeItemsSummary = false; referralSummaryCache = null;
  adminFilterActive = false; statsFilterActive = false;
  payoutsData = null; payoutsScope = 'live'; confirmingPayoutId = null; accountMsg = null; reportsRows = [];
  referralAdminData = null; confirmingReferralId = null; referralHistoryData = null;
  adminPharmacistFilter = null; previousDuesCache = null; adminFilter = defaultAdminFilter();
  payoutsHistoryData = null; payoutsHistoryFilter = { city:'', search:'' }; payoutsHistoryFilterActive = false;
  compensationItemsCache = { ASIL:null, ZAROZA:null }; catMgmtSubTab = 'NORMAL';
  compReportsFilter = { ASIL: defaultCompFilter(), ZAROZA: defaultCompFilter() };
  compReportsRows = { ASIL: null, ZAROZA: null }; compReportsActive = { ASIL:false, ZAROZA:false };
  messagesState = defaultMessagesState(); messagesCampaignsCache = null; messagesCampaignDetailCache = {};
  messagesExpandedCampaignId = null; messagesPendingSend = null; messagesSending = false; messagesLastResult = null;
  messagesDraft = { name:'', text:'' };
}

function currentDepartmentParam(){
  if(currentUser.type === 'pharmacist') return selectedDepartment;
  return adminDeptFilter || null;
}

async function loadCategories(){
  const dep = currentDepartmentParam();
  const qs = dep ? ('?department=' + dep) : '';
  const res = await apiRequest('/categories' + qs);
  CATEGORIES = res.data;
}

async function loadCompensationItems(type){
  const dep = currentDepartmentParam() || 'COSMETICS';
  const qs = '?type=' + type + (dep ? ('&department=' + dep) : '');
  const res = await apiRequest('/compensation-items' + qs);
  compensationItemsCache[type] = res.data;
}

/* ============================================================
   بعد تسجيل الدخول — التطبيق الرئيسي
   ============================================================ */
function adminRoleLabel(_u){
  return 'المدير';
}

const SHELL_WIDE_TABS = new Set(['admin','messages','reports','users','stats','payouts','payoutsHistory','referralAdmin','account','compReportsAsil','compReportsZaroza']);
// [key, icon, label, cosmeticsAdminOnly]
const SHELL_USER_TABS = [
  ['add','＋','إضافة'],
  ['history','🧾','السجل'],
  ['payoutInfo','💳','بيانات الاستلام'],
  ['earnings','💰','مستحقاتي'],
  ['previousDues','🗓️','التحويلات السابقة'],
  ['referral','🎁','الإحالة'],
];
const SHELL_ADMIN_TABS = [
  ['admin','⚙️','الإدارة'],
  ['messages','📨','رسائل جماعية'],
  ['reports','📊','تقارير العمولات'],
  ['compReportsAsil','🔄','تعويض الأصيل',true],
  ['compReportsZaroza','🔄','تعويض زاروزا',true],
  ['users','🗂️','الأصناف'],
  ['stats','📈','العملاء المسجلون'],
  ['payouts','💰','الدفعات الشهرية'],
  ['payoutsHistory','📜','الدفعات الشهرية السابقة'],
  ['referralAdmin','🤝','مستحقات الإحالة'],
  ['account','🔑','حسابي'],
];

function shellDepartmentBarHtml(){
  return `
    <div class="sx-33">
      <span class="sx-34">القسم الحالي: ${deptLabel(selectedDepartment)}</span>
      <button class="logout sx-35" data-click="switchDepartment">تبديل القسم</button>
    </div>`;
}
function shellSaleModeBarHtml(){
  return `
    <div class="sx-36">
      <span class="sx-34">نوع العملية: ${saleModeLabel(saleMode)}</span>
      <button class="logout sx-35" data-click="switchSaleMode">تبديل</button>
    </div>`;
}
function shellAdminPanelBarHtml(){
  return `
    <div class="sx-33">
      <span class="sx-34">اللوحة الحالية: ${deptLabel(adminDeptFilter)}</span>
      <button class="logout sx-35" data-click="switchAdminPanel">تبديل اللوحة</button>
    </div>`;
}
function shellHeaderBarsHtml(isAdmin){
  if(isAdmin) return shellAdminPanelBarHtml();
  return shellDepartmentBarHtml() + (selectedDepartment==='COSMETICS' ? shellSaleModeBarHtml() : '');
}

function shellTabButtonHtml([key, icon, label]){
  return `<button class="${activeTab===key?'active':''}" data-click="switchTab" ${DA('click', String(key))}><span class="ic">${icon}</span>${label}</button>`;
}
function shellTabbarHtml(isAdmin){
  if(!isAdmin) return SHELL_USER_TABS.map(shellTabButtonHtml).join('\n      ');
  const showCosmetics = isCosmeticsAdminContext();
  return SHELL_ADMIN_TABS.filter(tab => !tab[3] || showCosmetics).map(shellTabButtonHtml).join('\n      ');
}

function renderActiveTab(tab){
  switch(tab){
    case 'add': return tabAdd();
    case 'history': return tabHistory();
    case 'payoutInfo': return tabPayoutInfo();
    case 'earnings': return tabEarnings();
    case 'previousDues': return tabPreviousDues();
    case 'referral': return tabReferral();
    case 'reports': return tabReports();
    case 'compReportsAsil': return tabCompReports('ASIL');
    case 'compReportsZaroza': return tabCompReports('ZAROZA');
    case 'users': return tabCategoriesMgmt();
    case 'stats': return tabPharmacists();
    case 'payouts': return tabPayouts();
    case 'payoutsHistory': return tabPayoutsHistory();
    case 'referralAdmin': return tabReferralAdmin();
    case 'admin': return tabAdmin();
    case 'messages': return tabMessages();
    case 'account': return tabAccount();
    default: return '';
  }
}

function screenAppShell(){
  const isAdmin = currentUser.type === 'admin';
  const isWide = SHELL_WIDE_TABS.has(activeTab);
  const nameLine = esc(isAdmin ? currentUser.fullName : currentUser.pharmacyName);
  const subLine = isAdmin ? (adminRoleLabel(currentUser) + ' · لوحة التحكم') : (esc(currentUser.fullName) + ' · ' + esc(currentUser.city));
  return `
  <div class="app-header">
    <div class="app-header-top">
      <div>
        <div class="pharmacy">${nameLine}</div>
        <div class="sub">${subLine}</div>
      </div>
      <button class="logout" data-click="doLogout">خروج</button>
    </div>
    ${shellHeaderBarsHtml(isAdmin)}
  </div>
  <div class="app-body ${isWide?'wide':''}" id="tabContent">
    ${renderActiveTab(activeTab)}
  </div>
  <div class="tabbar-fixed-wrap ${isWide?'wide':''}">
    <div class="tabbar ${isWide?'wide':''}">
      ${shellTabbarHtml(isAdmin)}
    </div>
  </div>`;
}

async function switchTab(tab){
  activeTab = tab;
  if(tab==='admin'){ adminPharmacistFilter = null; }
  if(tab==='payouts'){ confirmingPayoutId = null; }
  if(tab==='account'){ accountMsg = null; }
  if(tab==='add'){ resetAddFlow(); }
  if(tab==='payoutInfo'){ payoutDraft = null; payoutOtpSent = false; payoutOtpDev = null; payoutEditUnlocked = false; payoutEditOtpSent = false; payoutEditOtpDev = null; payoutEditCode = ''; }
  if(tab==='payouts'){ confirmingPayoutId = null; }
  if(tab==='referralAdmin'){ confirmingReferralId = null; }
  if(tab==='users'){ catMgmtSubTab = 'NORMAL'; }
  if(tab==='history'){
    // بقسم الأدوية النوع دايمًا "عادية" (نوع وحيد) — بالكوزمتك بيتذكر آخر فلتر اخترته المستخدم (Pills)
    if(selectedDepartment==='MEDICINE') historyFilterType = 'NORMAL';
  }
  render();
  await loadTabData(tab);
}

// القسم كوزمتك + نوع العملية تعويض (أصيل/زاروزا)
function isCompensationSaleMode(){
  return selectedDepartment==='COSMETICS' && (saleMode==='ASIL' || saleMode==='ZAROZA');
}

async function loadAddTabData(){
  if(isCompensationSaleMode()){
    if(!compensationItemsCache[saleMode]){ await loadCompensationItems(saleMode); render(); }
  } else {
    await loadCategories(); render();
  }
}
async function loadThenRender(loader){
  await loader(); render();
}
async function loadMessagesTabData(){
  if(!pharmacistsCache){ await loadPharmacists(); render(); }
  if(!messagesCampaignsCache){ await loadMessageCampaigns(); render(); }
}
async function loadReferralAdminTabData(){
  await loadReferralAdmin(); await loadReferralHistory(); render();
}
async function loadPharmacistsIfMissing(){
  if(!pharmacistsCache){ await loadPharmacists(); render(); }
}

function loadDataForTab(tab){
  switch(tab){
    case 'add': return loadAddTabData();
    case 'history':
    case 'payoutInfo':
    case 'earnings': return loadThenRender(loadMySales);
    case 'previousDues': return loadThenRender(loadPreviousDues);
    case 'referral': return loadThenRender(loadReferralSummary);
    case 'admin': return loadThenRender(loadAdminSales);
    case 'messages': return loadMessagesTabData();
    case 'users': return loadThenRender(loadCategories);
    case 'stats': return loadThenRender(loadPharmacists);
    case 'payouts': return loadThenRender(loadPayouts);
    case 'payoutsHistory': return loadThenRender(loadPayoutsHistory);
    case 'referralAdmin': return loadReferralAdminTabData();
    case 'reports':
    case 'compReportsAsil':
    case 'compReportsZaroza': return loadPharmacistsIfMissing();
    default: return undefined;
  }
}

async function loadTabData(tab){
  try{
    await loadDataForTab(tab);
  }catch(e){ toast(e.message, 'danger'); }
}

async function loadMySales(){
  const res = await apiRequest('/sales?pageSize=200');
  mySalesCache = res.data.items;
}
async function loadReferralSummary(){
  const res = await apiRequest('/referral/me');
  referralSummaryCache = res.data;
}
async function loadAdminSales(){
  let qs = '';
  if(adminPharmacistFilter){
    qs = '&pharmacistId=' + adminPharmacistFilter;
  } else if(currentDepartmentParam()){
    qs = '&department=' + currentDepartmentParam();
  }
  const res = await apiRequest('/sales?pageSize=300' + qs);
  adminSalesCache = res.data.items;
}
async function loadPharmacists(){
  const res = await apiRequest('/users/pharmacists');
  pharmacistsCache = res.data;
}
async function loadPreviousDues(){
  const res = await apiRequest('/payouts/me');
  previousDuesCache = res.data.rows;
}
async function loadPayouts(){
  const res = await apiRequest('/payouts?scope=' + payoutsScope);
  payoutsData = res.data;
}
async function loadReferralAdmin(){
  const res = await apiRequest('/referral/admin/summary');
  referralAdminData = res.data;
}
async function loadReferralHistory(){
  const res = await apiRequest('/referral/admin/history');
  referralHistoryData = res.data;
}
async function loadPayoutsHistory(){
  const params = new URLSearchParams();
  if(payoutsHistoryFilterActive){
    if(payoutsHistoryFilter.city) { params.set('city', payoutsHistoryFilter.city); }
    if(payoutsHistoryFilter.search) params.set('search', payoutsHistoryFilter.search);
  }
  const qs = params.toString() ? ('?' + params.toString()) : '';
  const res = await apiRequest('/payouts/history' + qs);
  payoutsHistoryData = res.data;
}

/* -------------------- تبويب: إضافة / تعديل عملية بيع -------------------- */
/* -------------------- تبويب: إضافة / تعديل عملية بيع -------------------- */
function renderSubmittedSaleTicket(s){
  return `
    <div class="ticket">
      <div class="commission-hero">
        <div class="lbl">⏳ تم إرسال العملية للمراجعة</div>
        <div class="amt"><span class="cur">دينار</span>${fmtMoney(s.commissionAmount)}</div>
        <div class="lbl">قيمة العمولة المتوقعة</div>
        <div class="sx-37"><span class="badge pending">بانتظار موافقة الإدارة</span></div>
      </div>
      <div class="sx-38">
        <div class="sx-39"><span>الصنف</span><b class="sx-32">${saleItemLabel(s)}</b></div>
        <div class="sx-39"><span>عدد القطع</span><b class="num sx-32">${s.quantity}</b></div>
        <div class="sx-40"><span>تاريخ الفاتورة</span><b class="sx-32">${fmtDate(s.saleDate)}</b></div>
        ${s.invoiceNumber ? `<div class="sx-41"><span>رقم الفاتورة</span><b class="num sx-32">${esc(s.invoiceNumber)}</b></div>` : ''}
      </div>
      <div class="sx-42">لا يمكن تعديل العملية أو حذفها بعد الإرسال. لو في خطأ، سيتم رفضها من الإدارة وتقدر ترسل عملية جديدة.</div>
    </div>
    <button class="btn" data-click="finalizeSale">تسجيل عملية بيع جديدة</button>
    <button class="btn ghost sx-37" data-click="goToHistoryAfterSale">📜 مراجعة سجل المبيعات</button>`;
}
function renderQtyStep(){
  return `
  <div class="step-block ${addFlow.qty?'step-done':''}">
    <div class="step-label"><span class="step-num">2</span> عدد القطع المباعة</div>
    <div class="row2">
      <input type="number" id="qtyInput" min="1" step="1" placeholder="مثال: 5" value="${addFlow.qty||''}">
      <button class="btn sm sx-22" data-click="saveQty">حفظ</button>
    </div>
  </div>`;
}
function categoryOptionsHtml(){
  return CATEGORIES.map(c=>`<option value="${c.id}" ${addFlow.categoryId===c.id?'selected':''}>${esc(c.name)} — ${fmtMoney(c.effectiveCommissionPerUnit ?? c.commissionPerUnit)} دينار/قطعة</option>`).join('');
}

function tabAdd(){
  if(isCompensationSaleMode()){
    return tabAddCompensation();
  }
  if(CATEGORIES.length===0){
    return `<div class="section-title">إضافة عملية بيع</div><p class="sx-43">جارِ تحميل الأصناف...</p>`;
  }
  const isEditing = false;
  const invoiceSubmitLabel = isEditing ? 'حفظ التعديل وإعادة الإرسال' : 'حفظ وتسجيل العمولة';

  if(lastSubmittedSale){
    return renderSubmittedSaleTicket(lastSubmittedSale);
  }

  return `
  <div class="section-title">${isEditing ? 'تعديل عملية بيع' : 'تسجيل عملية بيع'}</div>
  ${isEditing ? `<div class="otp-banner sx-44"><span>أنت تعدّل عملية موجودة — يمكن التعديل ما دامت "قيد المراجعة"</span></div>` : ''}

  <div class="step-block ${addFlow.categoryId?'step-done':''}">
    <div class="step-label"><span class="step-num">1</span> اختر الصنف</div>
    <select class="cat-select" data-change="pickCategory" data-change-pass="value">
      <option value="" ${!addFlow.categoryId?'selected':''} disabled>اختر صنف المنتج</option>
      ${categoryOptionsHtml()}
    </select>
  </div>

  ${addFlow.categoryId ? renderQtyStep() : ''}

  ${addFlow.qty ? renderInvoiceStep(3, invoiceSubmitLabel, false) : ''}
  `;
}

/* -------------------- تبويب: إضافة عملية تعويض (الأصيل / زاروزا) -------------------- */
function renderSubmittedCompensationTicket(s){
  return `
    <div class="ticket">
      <div class="commission-hero">
        <div class="lbl sx-45">✅ تم إرسال طلب التعويض بنجاح</div>
        <div class="sx-46">سيتم التحقق من فاتورة التعويض. شكرًا لك</div>
        <div class="sx-47"><span class="badge pending">بانتظار موافقة الإدارة</span></div>
      </div>
      <div class="sx-38">
        <div class="sx-39"><span>الصنف</span><b class="sx-32">${s.compensationItem ? esc(s.compensationItem.name) : ''}</b></div>
        <div class="sx-39"><span>الصنف الفري</span><b class="sx-32">${s.freeCompensationItem ? esc(s.freeCompensationItem.name) : ''}</b></div>
        <div class="sx-40"><span>تاريخ البيع</span><b class="sx-32">${fmtDate(s.saleDate)}</b></div>
      </div>
    </div>
    <button class="btn" data-click="finalizeSale">تسجيل عملية جديدة</button>
    <button class="btn ghost sx-37" data-click="goToHistoryAfterSale">📜 مراجعة سجل المبيعات</button>`;
}
function compensationOptionsHtml(items, selectedId){
  return items.map(c=>`<option value="${c.id}" ${selectedId===c.id?'selected':''}>${esc(c.name)} — ${fmtMoney(c.price)} دينار</option>`).join('');
}
function renderFreeItemStep(items, mainItem){
  return `
  <div class="step-block ${addFlow.freeItemId?'step-done':''}">
    <div class="step-label"><span class="step-num">2</span> اختر الصنف الفري (المجاني)</div>
    <select class="cat-select" data-change="pickFreeItem" data-change-pass="value">
      <option value="" ${!addFlow.freeItemId?'selected':''} disabled>اختر الصنف الفري</option>
      ${compensationOptionsHtml(items, addFlow.freeItemId)}
    </select>
    <div class="sx-48">* يجب أن يكون سعر الصنف الفري أقل من أو يساوي سعر الصنف الأساسي (${fmtMoney(mainItem.price)} دينار)</div>
  </div>`;
}

function tabAddCompensation(){
  const title = saleMode==='ASIL' ? 'تسجيل تعويض الأصيل' : 'تسجيل تعويض زاروزا';
  const items = compensationItemsCache[saleMode];

  if(items===null || items===undefined){
    return `<div class="section-title">${title}</div><p class="sx-43">جارِ تحميل الأصناف...</p>`;
  }

  const isEditing = false;
  const invoiceSubmitLabel = isEditing ? 'حفظ التعديل وإعادة الإرسال' : 'إرسال طلب التعويض';

  if(lastSubmittedSale){
    return renderSubmittedCompensationTicket(lastSubmittedSale);
  }

  if(items.length===0){
    return `
    <div class="section-title">${title}</div>
    <div class="empty-state">
      <div class="ic">🗂️</div>
      <div class="t">لا توجد أصناف مضافة بعد</div>
      <div class="d">الرجاء التواصل مع الإدارة لإضافة الأصناف</div>
    </div>`;
  }

  const mainItem = items.find(c=>c.id===addFlow.mainItemId);

  return `
  <div class="section-title">${title}</div>
  ${isEditing ? `<div class="otp-banner sx-44"><span>أنت تعدّل عملية موجودة — يمكن التعديل ما دامت "قيد المراجعة"</span></div>` : ''}

  <div class="step-block ${addFlow.mainItemId?'step-done':''}">
    <div class="step-label"><span class="step-num">1</span> اختر الصنف</div>
    <select class="cat-select" data-change="pickMainItem" data-change-pass="value">
      <option value="" ${!addFlow.mainItemId?'selected':''} disabled>اختر صنف المنتج</option>
      ${compensationOptionsHtml(items, addFlow.mainItemId)}
    </select>
  </div>

  ${addFlow.mainItemId ? renderFreeItemStep(items, mainItem) : ''}

  ${addFlow.freeItemId ? renderInvoiceStep(3, invoiceSubmitLabel, true) : ''}
  `;
}

function pickMainItem(id){
  addFlow.mainItemId = id; addFlow.freeItemId=null; addFlow.date=null;
  pendingInvoiceFile=null; pendingInvoicePreview=null;
  render();
}

function pickFreeItem(id){
  const items = compensationItemsCache[saleMode] || [];
  const mainItem = items.find(c=>c.id===addFlow.mainItemId);
  const freeItem = items.find(c=>c.id===id);
  if(!mainItem || !freeItem) return;
  if(Number(freeItem.price) > Number(mainItem.price)){
    toast('يجب أن يكون سعر الفري أقل من أو يساوي سعر الأصلي', 'danger');
    render();
    return;
  }
  addFlow.freeItemId = id;
  if(!addFlow.date) { addFlow.date = toLocalDateStr(new Date()); }
  pendingInvoiceFile=null; pendingInvoicePreview=null;
  render();
}

function invoiceDateBounds(){
  const now = new Date();
  const min = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60);
  return { min: toLocalDateStr(min), max: toLocalDateStr(now) };
}
function canSubmitInvoice(){
  return !!(pendingInvoiceFile && addFlow.date);
}
function updateFinalBtn(){
  const btn = document.getElementById('finalSaveBtn');
  if(btn) btn.disabled = !canSubmitInvoice();
}
function onInvoiceNumberInput(el){ addFlow.invoiceNumber = el.value; updateFinalBtn(); }

function renderInvoiceStep(stepNum, submitLabel, isCompensation){
  const b = invoiceDateBounds();
  const dateBlock = addFlow.dateEditing ? `
    <div class="row2 sx-49">
      <input type="date" id="dateInput" value="${esc(addFlow.date||b.max)}" min="${b.min}" max="${b.max}">
      <button class="btn sm sx-22" data-click="saveDate">حفظ</button>
    </div>` : `
    <div class="sx-50">
      <span>تاريخ الفاتورة: <b class="sx-32">${fmtDate(addFlow.date)}</b></span>
      <button type="button" data-click="toggleDateEdit" class="sx-51">(تغيير التاريخ)</button>
    </div>`;

  const noteHtml = isCompensation
    ? `⚠️ بعد الإرسال ما بتقدر تعدّل العملية أو تحذفها، تأكد من الصورة والتاريخ.`
    : `⚠️ بعد الإرسال ما بتقدر تعدّل العملية أو تحذفها، تأكد من الصورة والكمية والتاريخ.`;

  return `
  <div class="step-block">
    <div class="step-label"><span class="step-num">${stepNum}</span> بيانات الفاتورة</div>
    ${dateBlock}
    <div class="row2 sx-52">
      <button type="button" class="btn sm sx-26" data-click="clickElementById" data-click-args="[&quot;invoiceFileCamera&quot;]">📷 التقط صورة</button>
      <button type="button" class="btn sm ghost sx-26" data-click="clickElementById" data-click-args="[&quot;invoiceFileGallery&quot;]">🖼️ من المكتبة</button>
    </div>
    <input type="file" id="invoiceFileCamera" accept="image/*" capture="environment" class="sx-53" data-change="handleInvoiceFile" data-change-pass="this">
    <input type="file" id="invoiceFileGallery" accept="image/*" class="sx-53" data-change="handleInvoiceFile" data-change-pass="this">
    ${pendingInvoicePreview ? `
    <div class="file-drop">
      <img id="invoicePreview" class="preview-img sx-54" src="${pendingInvoicePreview}">
    </div>` : ''}
    <div class="sx-55">
      ${noteHtml}
    </div>
    <button class="btn sx-47" id="finalSaveBtn" ${canSubmitInvoice()?'':'disabled'} data-click="saveInvoiceAndFinish">${submitLabel}</button>
  </div>`;
}

function toggleDateEdit(){ addFlow.dateEditing = true; render(); }

function pickCategory(id){ addFlow.categoryId = id; addFlow.qty=null; addFlow.date=null; addFlow.dateEditing=false; pendingInvoiceFile=null; pendingInvoicePreview=null; render(); }

function saveQty(){
  const v = Number.parseInt(document.getElementById('qtyInput').value, 10);
  if(!v || v < 1){ toast('الرجاء إدخال عدد قطع صحيح', 'danger'); return; }
  addFlow.qty = v;
  if(!addFlow.date) { addFlow.date = toLocalDateStr(new Date()); }
  render();
}

function saveDate(){
  const v = document.getElementById('dateInput').value;
  if(!v){ toast('الرجاء اختيار تاريخ البيع', 'danger'); return; }
  addFlow.date = v; addFlow.dateEditing = false;
  render();
}

async function handleInvoiceFile(input){
  const file = input.files[0];
  if(!file) return;
  try{
    const { blob, dataUrl } = await resizeImageToBlob(file);
    pendingInvoiceFile = new File([blob], 'invoice.jpg', { type:'image/jpeg' });
    pendingInvoicePreview = dataUrl;
    const prev = document.getElementById('invoicePreview');
    if(prev){ prev.src = dataUrl; prev.style.display = 'block'; }
    updateFinalBtn();
  }catch(e){
    toast(e.message, 'danger');
  }
}

async function saveInvoiceAndFinish(){
  if(!pendingInvoiceFile){ toast('الرجاء إرفاق صورة الفاتورة', 'danger'); return; }

  const isCompensation = selectedDepartment==='COSMETICS' && (saleMode==='ASIL' || saleMode==='ZAROZA');
  const invNo = '';

  const btn = document.getElementById('finalSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ الإرسال...'; }
  try{
    const fd = new FormData();
    if(isCompensation){
      fd.append('saleType', saleMode);
      fd.append('compensationItemId', addFlow.mainItemId);
      fd.append('freeCompensationItemId', addFlow.freeItemId);
    } else {
      fd.append('saleType', 'NORMAL');
      fd.append('categoryId', addFlow.categoryId);
      fd.append('quantity', addFlow.qty);
    }
    fd.append('saleDate', addFlow.date);
    fd.append('invoiceNumber', invNo);
    fd.append('invoiceImage', pendingInvoiceFile);

    const res = await apiRequest('/sales', { method:'POST', form: fd });
    lastSubmittedSale = res.data;
    pendingInvoiceFile = null; pendingInvoicePreview = null;
    mySalesCache = null;
    render();
  }catch(e){
    toast(e.message, 'danger');
    const defaultLabel = isCompensation ? 'إرسال طلب التعويض' : 'حفظ وتسجيل العمولة';
    if(btn){ btn.disabled = false; btn.textContent = defaultLabel; }
  }
}

function finalizeSale(){
  resetAddFlow();
  render();
}

// من شاشة "تم إرسال العملية": ينقل الصيدلي لتبويب السجل مباشرة، وبيفتح الفلتر المناسب
// لنوع العملية اللي لسا مسجّلها (عادية / تعويض الأصيل / تعويض زاروزا) عشان يشوفها فورًا.
// (قسم الأدوية دايمًا "عادية" وبتنضبط تلقائيًا بـ switchTab.)
async function goToHistoryAfterSale(){
  const type = lastSubmittedSale?.saleType || saleMode || 'NORMAL';
  historyFilterType = (type==='ASIL' || type==='ZAROZA') ? type : 'NORMAL';
  historyStatusFilter = 'ALL';
  showFreeItemsSummary = false;
  // switchTab بتلتقط أخطاء تحميل البيانات داخليًا (loadTabData)؛ هون بنغطّي فقط الخطأ المتزامن من render()
  try{
    await switchTab('history');
  }catch(e){ toast(e.message, 'danger'); }
}

function saleItemLabel(s){
  const type = s.saleType || 'NORMAL';
  if(type === 'ASIL' || type === 'ZAROZA'){
    const mainName = s.compensationItem ? esc(s.compensationItem.name) : '—';
    const freeName = s.freeCompensationItem ? esc(s.freeCompensationItem.name) : '—';
    return `${mainName} <span class="sx-56">(فري: ${freeName})</span>`;
  }
  return s.category ? esc(s.category.name) : '';
}

/* -------------------- تبويب: السجل -------------------- */
function historyVisibleSales(){
  const byDept = mySalesCache.filter(s => (s.saleType||'NORMAL')!=='NORMAL' || s.department===selectedDepartment);
  return historyFilterType==='ALL' ? byDept : byDept.filter(s => (s.saleType||'NORMAL')===historyFilterType);
}
function historyHeaderHtml(){
  const typePills = historyTypePills();
  const pillsTypeHtml = typePills.length ? `
  <div class="filter-pills">
    ${typePills.map(f=>`<button class="pill ${historyFilterType===f.value?'active':''}" data-click="pickHistoryType" ${DA('click', String(f.value))}>${esc(f.label)}</button>`).join('')}
  </div>` : '';

  const pillsStatusHtml = `
  <div class="filter-pills sx-27">
    ${HISTORY_STATUS_PILLS.map(f=>`<button class="pill sub ${f.value} ${historyStatusFilter===f.value?'active':''}" data-click="pickHistoryStatus" ${DA('click', String(f.value))}>${esc(f.label)}</button>`).join('')}
  </div>`;
  return `
  <div class="section-title">${historyFilterLabel(historyFilterType)}</div>
  ${pillsTypeHtml}
  ${pillsStatusHtml}`;
}
function historyFreeItemsBtnHtml(isCompOnly){
  if(!isCompOnly) return '';
  const toggleLabel = showFreeItemsSummary ? 'إخفاء القطع الفري المستحقة' : '🎁 عرض القطع الفري المستحقة';
  return `<button class="btn ghost sm sx-57" data-click="toggleFreeItemsSummary">${toggleLabel}</button>`;
}
function historySummaryHtml(mySales, isCompOnly){
  const approvedList = mySales.filter(s=>s.status==='APPROVED');
  const pendingList  = mySales.filter(s=>s.status==='PENDING');
  const rejectedList = mySales.filter(s=>s.status==='REJECTED');
  const approvedTotal = approvedList.reduce((sum,s)=>sum+Number(s.commissionAmount),0);
  return `
  <div class="hs-grid">
    <div class="hs-box ok">
      <div class="lbl">مقبولة</div>
      <div class="val num">${isCompOnly ? (approvedList.length + ' فاتورة') : (fmtMoney(approvedTotal) + ' د.أ')}</div>
    </div>
    <div class="hs-box pending">
      <div class="lbl">قيد المراجعة</div>
      <div class="val num">${pendingList.length}</div>
    </div>
    <div class="hs-box rejected">
      <div class="lbl">مرفوضة</div>
      <div class="val num">${rejectedList.length}</div>
    </div>
  </div>`;
}

function tabHistory(){
  if(mySalesCache===null){
    return `<div class="section-title">سجل المبيعات</div><p class="sx-43">جارِ التحميل...</p>`;
  }
  if(selectedDepartment==='MEDICINE') { historyFilterType = 'NORMAL'; }

  const mySales = historyVisibleSales();

  const isCompOnly = historyFilterType==='ASIL' || historyFilterType==='ZAROZA';

  // فلترة حسب الحالة (Pill الثاني) — تُطبَّق فوق فلتر النوع، بعد حساب الملخص أعلاه
  const shown = historyStatusFilter==='ALL' ? mySales : mySales.filter(s=>s.status===historyStatusFilter);

  const header = historyHeaderHtml();
  const summaryHtml = historySummaryHtml(mySales, isCompOnly);

  if(mySales.length===0){
    return `
    ${header}
    <div class="empty-state">
      <div class="ic">🧾</div>
      <div class="t">لا يوجد سجل بعد</div>
      <div class="d">ابدأ بتسجيل أول عملية من تبويب «إضافة»</div>
    </div>`;
  }

  if(shown.length===0){
    return `
    ${header}
    ${summaryHtml}
    <div class="empty-state">
      <div class="ic">🔎</div>
      <div class="t">ما في فواتير مطابقة لهاي الفلترة</div>
      <div class="d">جرّب تغيير فلتر الحالة بالأعلى</div>
    </div>`;
  }

  return `
  ${header}
  ${historyFreeItemsBtnHtml(isCompOnly)}
  ${isCompOnly && showFreeItemsSummary ? freeItemsSummaryHtml(mySales) : ''}
  ${summaryHtml}
  ${renderHistoryTickets(shown)}
  `;
}

// يرسم بطاقات الفواتير مع عناوين فاصلة بين الأيام/الأشهر (اليوم / أمس / أيلول ٢٠٢٦...)
function compensationItemNameHtml(item){
  return item ? esc(item.name) : '—';
}
function invoiceNumberSuffixHtml(s){
  return s.invoiceNumber ? ' · فاتورة ' + esc(s.invoiceNumber) : '';
}
function historyTicketBodyHtml(s, isComp){
  return isComp ? `
          <div class="cat sx-58">القطعة المباعة : <b>${compensationItemNameHtml(s.compensationItem)}</b></div>
          <div class="cat sx-58">قطعة التعويض : <b>${compensationItemNameHtml(s.freeCompensationItem)}</b></div>
          <div class="meta">${fmtDate(s.saleDate)}</div>
          ` : `
          <div class="cat">${saleItemLabel(s)}</div>
          <div class="meta">${s.quantity} قطعة · ${fmtDate(s.saleDate)}${invoiceNumberSuffixHtml(s)}</div>
          `;
}
function historyTicketHtml(s, isComp){
  return `
    <div class="ticket">
      <div class="sale-row">
        ${s.invoiceImageUrl ? `<img class="thumb" src="${s.invoiceImageUrl}" data-click="openImageModal" ${DA('click', String(s.invoiceImageUrl), invoiceFileName(s))}>` : ''}
        <div class="sx-26">
          ${historyTicketBodyHtml(s, isComp)}
          <div class="sx-59">${statusBadgeHtml(s)}</div>
          ${s.status==='REJECTED' ? `<div class="reject-box"><span class="ic">⚠️</span><div><b>تم رفض الطلب</b><br>السبب: ${esc(s.rejectionReason||'غير محدد')}</div></div>` : ''}
        </div>
        ${isComp ? '' : `<div class="commission">${fmtMoney(s.commissionAmount)} د.أ</div>`}
      </div>
    </div>`;
}

function renderHistoryTickets(list){
  let lastGroup = null;
  let out = '';
  for(const s of list){
    const group = historyDateGroupLabel(s.createdAt || s.saleDate);
    if(group !== lastGroup){
      out += `<div class="date-sep">${esc(group)}</div>`;
      lastGroup = group;
    }
    const isComp = (s.saleType||'NORMAL')==='ASIL' || (s.saleType||'NORMAL')==='ZAROZA';
    out += historyTicketHtml(s, isComp);
  }
  return out;
}

function freeItemsSummaryHtml(mySales){
  const approved = mySales.filter(s=>s.status==='APPROVED');
  const counts = {};
  for(const s of approved){
    const name = s.freeCompensationItem ? s.freeCompensationItem.name : 'غير محدد';
    counts[name] = (counts[name]||0) + 1;
  }
  const entries = Object.entries(counts);
  if(entries.length===0){
    return `
    <div class="ticket sx-57">
      <div class="sx-60">ما في قطع فري مستحقة بعد — بتظهر هون أول ما تنعتمد أول فاتورة</div>
    </div>`;
  }
  const total = entries.reduce((sum,[,c])=>sum+c, 0);
  return `
  <div class="ticket sx-57">
    <div class="sx-61">🎁 القطع الفري المستحقة (من الفواتير المؤكدة)</div>
    ${entries.map(([name,count])=>`
      <div class="sx-62">
        <span>${esc(name)}</span><b class="num">× ${count}</b>
      </div>`).join('')}
    <div class="sx-63">
      <span>الإجمالي</span><span class="num">${total} قطعة</span>
    </div>
  </div>`;
}

function pickHistoryType(type){
  historyFilterType = type;
  showFreeItemsSummary = false;
  render();
}
function pickHistoryStatus(status){
  historyStatusFilter = status;
  render();
}

function toggleFreeItemsSummary(){
  showFreeItemsSummary = !showFreeItemsSummary;
  render();
}

/* -------------------- تبويب: الدفع -------------------- */
function computeMyPayoutSummary(){
  const mySales = mySalesCache || [];
  const approved = mySales.filter(s=>s.status==='APPROVED');
  const pending = approved.filter(s=>!s.paid).reduce((a,s)=>a+Number(s.commissionAmount),0);
  const transferredSales = approved.filter(s=>s.paid);
  const transferred = transferredSales.reduce((a,s)=>a+Number(s.commissionAmount),0);
  const lastTransfer = transferredSales.sort((a,b)=> new Date(b.paidAt)-new Date(a.paidAt))[0];
  // فواتير لسا ما راجعها الأدمن (قبول/رفض) — عمولة تقديرية غير مؤكدة بعد
  const underReview = mySales.filter(s=>s.status==='PENDING');
  const underReviewAmount = underReview.reduce((a,s)=>a+Number(s.commissionAmount),0);
  return {
    pending, transferred, lastTransferAt: lastTransfer ? lastTransfer.paidAt : null,
    hasAnySale: mySales.length>0,
    underReviewAmount, underReviewCount: underReview.length,
  };
}

/* -------------------- تبويب: بيانات الاستلام -------------------- */
function payoutIntroHtml(){
  return `
    <div class="section-title">بيانات الاستلام</div>
    <div class="otp-banner sx-64">
      💡 يتم تحويل المستحقات <b>مرة واحدة كل شهر (يوم 1)</b> عن فواتير الشهر الماضي المقبولة. الفواتير المرسلة من أول الشهر الجديد بتنحسب بالدفعة اللي بعدها.
    </div>
    <div class="otp-banner sx-65">
      🔒 لحمايتك، تغيير بيانات الاستلام لاحقًا يحتاج رمز تحقق يوصلك على هاتفك المسجّل.
    </div>
    <button class="btn" data-click="ackPayoutIntro">موافق، متابعة</button>`;
}
function payoutLockedActionsHtml(editedToday){
  if(editedToday){
    return `
    <div class="otp-banner sx-23">
      لقد عدّلت بيانات الاستلام اليوم بالفعل — التعديل مسموح مرة واحدة فقط يوميًا، حاول غدًا.
    </div>`;
  }
  if(!payoutEditOtpSent){
    return `
    <button class="btn ghost" data-click="startPayoutEdit">✏️ تعديل طريقة الاستلام</button>
    `;
  }
  return `
    <p class="sx-66">
      أدخل رمز التحقق المُرسل إلى هاتفك المسجّل لفتح التعديل.
    </p>
    ${payoutEditOtpDev ? `<div class="otp-banner"><span>وضع التطوير — رمز التحقق</span><span class="code">${esc(payoutEditOtpDev)}</span></div>` : ''}
    <div class="field">
      <label>رمز التحقق (6 أرقام)</label>
      <input type="text" id="payoutEditOtpInput" maxlength="6" inputmode="numeric" placeholder="XXXXXX">
    </div>
    <button class="btn" data-click="verifyPayoutEditOtp">تأكيد وفتح التعديل</button>
    <div class="sx-15"><button class="link-btn" data-click="startPayoutEdit">إعادة إرسال الرمز</button></div>
    `;
}
function payoutLockedHtml(savedType, savedValue){
    const editedToday = checkPayoutEditedToday();
  return `
    <div class="section-title">بيانات الاستلام</div>
    <p class="sx-67">
      هذه بيانات استلام مستحقاتك المالية الحالية.
    </p>

    <div class="field">
      <label>نوع الاستلام</label>
      <select disabled class="sx-68">
        <option>${payoutTypeLabel(savedType)}</option>
      </select>
    </div>
    <div class="field">
      <label>${savedType==='PHONE' ? 'رقم الهاتف لاستلام الدفعة' : 'الاسم المستعار'}</label>
      <input type="text" value="${esc(savedValue)}" disabled class="sx-68">
    </div>

    ${payoutLockedActionsHtml(editedToday)}
    `;
}
function payoutValueFieldHtml(type, isFirstTime){
  return `
  <div class="field">
    <label>${type==='PHONE' ? 'رقم الهاتف لاستلام الدفعة' : 'الاسم المستعار'}</label>
    <input type="${type==='PHONE' ? 'tel' : 'text'}" id="payoutValue" ${type==='PHONE' ? 'maxlength="10" inputmode="numeric"' : 'maxlength="50"'}
      placeholder="${type==='PHONE' ? 'مثال: 07XXXXXXXX' : 'مثال: اسم المحفظة أو الحساب'}"
      value="${esc(payoutDraft.value)}" data-input="onPayoutValueInput" data-input-pass="value">
  </div>
  <button class="btn" id="savePayoutBtn" data-click="savePayoutInfo">حفظ</button>
  ${!isFirstTime ? `<div class="sx-15"><button class="link-btn" data-click="cancelPayoutEdit">إلغاء</button></div>` : ''}
  `;
}
function payoutEditFormHtml(type, isFirstTime){
  return `
  <div class="section-title">بيانات الاستلام</div>
  <p class="sx-67">
    حدّد الطريقة التي تريد استلام مستحقاتك المالية عليها، ليتمكن المدير من تحويل المبلغ إليك بسهولة.
  </p>

  <div class="field">
    <label>نوع الاستلام</label>
    <select id="payoutType" data-change="onPayoutTypeChange" data-change-pass="value">
      <option value="" ${type===''?'selected':''} disabled>اختر نوع الاستلام</option>
      <option value="PHONE" ${type==='PHONE'?'selected':''}>رقم هاتف</option>
      <option value="ALIAS" ${type==='ALIAS'?'selected':''}>اسم مستعار</option>
    </select>
  </div>

  ${type ? payoutValueFieldHtml(type, isFirstTime) : ''}
  `;
}

function tabPayoutInfo(){
  const savedType = currentUser.payoutType || '';
  const savedValue = currentUser.payoutValue || '';
  const isFirstTime = !savedType && !savedValue;

  if(isFirstTime && !payoutIntroAcked){
    return payoutIntroHtml();
  }

  if(!payoutDraft) { payoutDraft = { type: savedType, value: savedValue }; }

  // بعد أول مرة: الحقول تُعرض مقفولة (غير قابلة للتعديل) لحد ما يضغط "تعديل"
  // ويتحقق برمز يوصله على هاتفه المسجّل
  if(!isFirstTime && !payoutEditUnlocked){
    return payoutLockedHtml(savedType, savedValue);
  }

  // التعديل مفتوح (أول مرة، أو بعد التحقق من الرمز): الحقول قابلة للتعديل بشكل طبيعي
  return payoutEditFormHtml(payoutDraft.type || '', isFirstTime);
}

function ackPayoutIntro(){
  payoutIntroAcked = true;
  render();
}

async function startPayoutEdit(){
  try{
    const r = await apiRequest('/users/me/payout/send-otp', { method:'POST' });
    payoutEditOtpSent = true;
    payoutEditOtpDev = r.data?.devOtpCode ? r.data.devOtpCode : null;
    toast('تم إرسال رمز التحقق إلى هاتفك');
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

function verifyPayoutEditOtp(){
  const el = document.getElementById('payoutEditOtpInput');
  const code = el ? el.value.trim() : '';
  if(!/^\d{6}$/.test(code)){ toast('رمز التحقق مكوّن من 6 أرقام', 'danger'); return; }
  payoutEditCode = code;
  payoutEditUnlocked = true;
  payoutDraft = { type: currentUser.payoutType || '', value: currentUser.payoutValue || '' };
  render();
}

function cancelPayoutEdit(){
  payoutDraft = null;
  payoutEditUnlocked = false; payoutEditOtpSent = false; payoutEditOtpDev = null; payoutEditCode = '';
  render();
}

// حد "مرة وحدة باليوم" — هذا تخزين محلي بالمتصفح فقط، يعني ممكن يلتف عليه لو مسح بيانات
// المتصفح أو استخدم جهاز/متصفح تاني. للحماية الحقيقية لازم نفس الحد يُطبّق من السيرفر أيضًا.
function checkPayoutEditedToday(){
  try{
    return localStorage.getItem('mm_payout_last_edit_date') === toLocalDateStr(new Date());
  }catch(e){ /* التخزين المحلي ممنوع (وضع خاص/إعدادات المتصفح): نعتبر إنه ما عدّل اليوم */ return false; }
}
function markPayoutEditedToday(){
  try{ localStorage.setItem('mm_payout_last_edit_date', toLocalDateStr(new Date())); }catch(e){ /* التخزين المحلي غير متاح — التسجيل اختياري */ }
}

function onPayoutTypeChange(v){
  payoutDraft = { type: v, value: (v === currentUser.payoutType ? (currentUser.payoutValue||'') : '') };
  render();
}
function onPayoutValueInput(v){
  if(!payoutDraft) { payoutDraft = { type: currentUser.payoutType||'', value:'' }; }
  payoutDraft.value = v;
}

async function savePayoutInfo(){
  const type = payoutDraft ? payoutDraft.type : '';
  if(!type){ toast('الرجاء اختيار نوع الاستلام', 'danger'); return; }
  const valueEl = document.getElementById('payoutValue');
  const value = valueEl ? valueEl.value.trim() : '';
  if(!value){ toast('الرجاء إدخال ' + (type==='PHONE' ? 'رقم الهاتف' : 'الاسم المستعار'), 'danger'); return; }
  if(type==='PHONE' && !/^\d{10}$/.test(value)){ toast('رقم الهاتف يجب أن يتكون من 10 أرقام', 'danger'); return; }
  payoutDraft.value = value;

  const btn = document.getElementById('savePayoutBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ الحفظ...'; }
  try{
    const body = { payoutType:type, payoutValue:value };
    if(payoutEditCode){ body.code = payoutEditCode; }
    const res = await apiRequest('/users/me/payout', { method:'PATCH', json:body });
    currentUser.payoutType = res.data.payoutType;
    currentUser.payoutValue = res.data.payoutValue;
    const wasLockedEdit = !!payoutEditCode;
    payoutDraft = null;
    payoutEditUnlocked = false; payoutEditOtpSent = false; payoutEditOtpDev = null; payoutEditCode = '';
    if(wasLockedEdit) { markPayoutEditedToday(); }
    toast('تم حفظ بيانات الاستلام بنجاح');
    render();
  }catch(e){
    toast(e.message, 'danger');
    if(btn){ btn.disabled = false; btn.textContent = 'حفظ'; render(); }
  }
}

/* -------------------- تبويب: مستحقاتي -------------------- */
function tabEarnings(){
  if(mySalesCache===null){
    return `<div class="section-title">مستحقاتي</div><p class="sx-43">جارِ التحميل...</p>`;
  }
  const savedValue = currentUser.payoutValue || '';
  const summary = computeMyPayoutSummary();

  if(!summary.hasAnySale){
    return `
    <div class="section-title">مستحقاتي</div>
    <div class="empty-state">
      <div class="ic">💰</div>
      <div class="t">لسا ما سجّلت أي عملية بيع</div>
      <div class="d">أول ما تضيف عملية وتنقبل من الإدارة، بيظهر هون مجموع مستحقاتك.</div>
    </div>`;
  }

  const noPayoutInfoNote = !savedValue ? `
  <div class="otp-banner sx-69">
    <span>لسا ما أدخلت بيانات استلام الدفعة.</span>
    <button class="btn sm sx-70" data-click="switchTab" data-click-args="[&quot;payoutInfo&quot;]">إدخال بيانات الاستلام</button>
  </div>` : '';

  const pendingBlock = summary.pending>0 ? `
  <div class="history-summary sx-52">
    <div>
      <div class="lbl">إجمالي العمولات المستحقة (تمت الموافقة عليها)</div>
      <div class="val num">${fmtMoney(summary.pending)} د.أ</div>
    </div>
    <div class="cnt"><span class="badge pending">تم التأكيد، بانتظار تحويل المبلغ</span></div>
  </div>` : `
  <div class="history-summary sx-52">
    <div>
      <div class="lbl">إجمالي العمولات المستحقة (تمت الموافقة عليها)</div>
      <div class="val num">0.000 د.أ</div>
    </div>
    <div class="cnt"><span class="badge ok">لا يوجد مبلغ مستحق حاليًا</span></div>
  </div>`;

  const underReviewBlock = summary.underReviewCount>0 ? `
  <div class="history-summary sx-52">
    <div>
      <div class="lbl">العمولات الحالية (غير مؤكدة بعد)</div>
      <div class="val num">${fmtMoney(summary.underReviewAmount)} د.أ</div>
    </div>
    <div class="cnt"><span class="badge sx-71">بانتظار موافقة الإدارة</span></div>
  </div>` : '';

  const lastTransferNote = summary.lastTransferAt ? ' — آخر تحويل ' + fmtDate(summary.lastTransferAt) : '';

  return `
  <div class="section-title">مستحقاتي</div>
  ${noPayoutInfoNote}
  ${pendingBlock}
  ${underReviewBlock}
  ${summary.transferred>0 ? `
  <div class="history-summary sx-72">
    <div>
      <div class="lbl">تم تحويله سابقًا${lastTransferNote}</div>
      <div class="val num">${fmtMoney(summary.transferred)} د.أ</div>
    </div>
    <div class="cnt"><span class="badge ok">✓ تم تحويل المبلغ</span></div>
  </div>` : ''}
  `;
}

/* -------------------- تبويب: مستحقاتي السابقة -------------------- */
function tabPreviousDues(){
  if(previousDuesCache===null){
    return `<div class="section-title">التحويلات السابقة</div><p class="sx-43">جارِ التحميل...</p>`;
  }
  const rows = previousDuesCache;
  if(rows.length===0){
    return `
    <div class="section-title">التحويلات السابقة</div>
    <div class="empty-state">
      <div class="ic">🗓️</div>
      <div class="t">لا يوجد تحويلات بعد</div>
      <div class="d">أول ما تحوّلك الإدارة مبلغ، بيظهر هون سجل كل شهر بقيمته.</div>
    </div>`;
  }
  return `
  <div class="section-title">التحويلات السابقة</div>
  <p class="sx-73">
    كل مبلغ تم تحويله لك فعليًا، شهرًا بشهر.
  </p>
  ${rows.map(r=>`
    <div class="ticket">
      <div class="sale-row">
        <div class="sx-26">
          <div class="cat">${fmtMonth(r.month)}</div>
          <div class="meta">${r.salesCount} عملية · تم التحويل ${fmtDate(r.paidAt)}${r.reference ? ' · مرجع: ' + esc(r.reference) : ''}</div>
          <div class="sx-59"><span class="badge ok">✓ تم التحويل</span></div>
        </div>
        <div class="commission">${fmtMoney(r.amount)} د.أ</div>
      </div>
    </div>
  `).join('')}
  `;
}

/* -------------------- تبويب: الإحالة -------------------- */
function tabReferral(){
  if(referralSummaryCache===null){
    return `<div class="section-title">🎁 إحالة صيدلي</div><p class="sx-43">جارِ التحميل...</p>`;
  }
  const s = referralSummaryCache;
  const referralLink = globalThis.location.origin + globalThis.location.pathname + '?ref=' + s.referralCode;

  return `
  <div class="section-title">🎁 إحالة صيدلي</div>
  <p class="sx-67">
    شارك الرابط أو الكود تبعك مع أي صيدلاني، ولما يسجل حساب جديد من خلاله ويسوي أول عملية بيع
    ويوافق عليها الأدمن — بتاخذ <b class="sx-32">1 دينار</b> مكافأة إحالة تلقائيًا.
  </p>

  <div class="field">
    <label>كود الإحالة تبعك</label>
    <div class="otp-banner sx-74">
      <span class="code sx-75">${s.referralCode || '—'}</span>
      <button class="btn ghost sm" data-click="copyReferralText" ${DA('click', String(s.referralCode))}>نسخ الكود</button>
    </div>
  </div>

  <div class="field">
    <label>رابط الدعوة (يفتح مباشرة على صفحة التسجيل بالكود معبّى تلقائيًا)</label>
    <div class="otp-banner sx-74">
      <span class="sx-76">${referralLink}</span>
      <button class="btn ghost sm" data-click="copyReferralText" ${DA('click', String(referralLink))}>نسخ الرابط</button>
    </div>
  </div>

  <div class="history-summary sx-77">
    <div>
      <div class="lbl">مكافآت مستحقة (بانتظار التحويل)</div>
      <div class="val num">${fmtMoney(s.pendingAmount)} د.أ</div>
    </div>
    <div class="cnt">عدد المفعّلين<b class="num">${s.activatedCount}</b></div>
  </div>
  ${s.paidAmount>0 ? `<div class="sx-78">تم تحويل ${fmtMoney(s.paidAmount)} د.أ سابقًا من مكافآت الإحالة</div>` : ''}

  <div class="sx-79">
    <div class="cat-mgmt-row sx-80">
      <div class="n num sx-81">${s.totalReferred}</div>
      <div class="p">إجمالي من سجّل من خلالك</div>
    </div>
    <div class="cat-mgmt-row sx-80">
      <div class="n num sx-81">${s.pendingActivationCount}</div>
      <div class="p">لسا ما سوّوا أول بيعة مقبولة</div>
    </div>
  </div>

  ${s.rewards.length>0 ? `
  <div class="section-title sx-82">من فعّل الإحالة</div>
  ${s.rewards.map(r=>`
    <div class="ticket">
      <div class="sale-row">
        <div class="sx-26">
          <div class="cat">${esc(r.pharmacyName)}</div>
          <div class="meta">${esc(r.fullName)} · انضم بتاريخ ${fmtDate(r.registeredAt)}</div>
          <div class="sx-59">${r.paid ? '<span class="badge ok">تم تحويل المكافأة</span>' : '<span class="badge pending">مكافأة بانتظار التحويل</span>'}</div>
        </div>
        <div class="commission">${fmtMoney(r.amount)} د.أ</div>
      </div>
    </div>
  `).join('')}
  ` : `
  <div class="empty-state">
    <div class="ic">🎁</div>
    <div class="t">ما في حدا فعّل الإحالة بعد</div>
    <div class="d">شارك الرابط أو الكود فوق مع صيادلة تعرفهم</div>
  </div>`}
  `;
}

function copyReferralText(text){
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(()=>toast('تم النسخ ✓')).catch(()=>toast('تعذر النسخ، انسخه يدويًا', 'danger'));
  } else {
    toast('تعذر النسخ التلقائي بهذا المتصفح، انسخه يدويًا', 'danger');
  }
}

/* -------------------- قائمة مراجعة الفواتير (لوحة الأدمن) -------------------- */
function reviewInfoHtml(s, isComp){
  return isComp ? `
            <div class="m sx-59">القطعة المباعة : <b class="sx-32">${compensationItemNameHtml(s.compensationItem)}</b></div>
            <div class="m">قطعة التعويض : <b class="sx-32">${compensationItemNameHtml(s.freeCompensationItem)}</b></div>
            <div class="m">${fmtDate(s.saleDate)}</div>
            ` : `
            <div class="n sx-83">${saleItemLabel(s)}</div>
            <div class="m">${s.quantity} قطعة · ${fmtDate(s.saleDate)}<br>عمولة متوقعة: <b class="num">${fmtMoney(s.commissionAmount)} د.أ</b></div>
            `;
}
function similarImageOwnerLabel(similar){
  if(similar.sameOwner) return 'أخرى لنفس الصيدلي';
  return `من "${esc(similar.pharmacyName)}"`;
}
function reviewWarningsHtml(s){
  return `
        ${s.isDuplicate ? `<div class="dup-warning">⚠️ يوجد سجل آخر بنفس الصنف/الكمية/التاريخ لنفس الصيدلي — الرجاء التدقيق قبل القبول</div>` : ''}
        ${s.duplicateImageCount > 0 ? `<div class="dup-warning">⚠️ نفس صورة الفاتورة مستخدمة في ${s.duplicateImageCount} عملية أخرى — تأكد إنها مش نفس الفاتورة مكررة</div>` : ''}
        ${s.invoiceNumberSharedWithOthers ? `<div class="dup-warning">⚠️ رقم الفاتورة هذا مستخدم من صيدلي آخر — الرجاء التدقيق</div>` : ''}
        ${s.similarInvoiceImage ? `<div class="dup-warning">
          🔎 صورة مشابهة بنسبة ${s.similarInvoiceImage.similarity}% لفاتورة ${similarImageOwnerLabel(s.similarInvoiceImage)} — ممكن تكون نفس الفاتورة اتصوّرت مرتين
          <button class="btn ghost sm sx-84" data-click="openCompareImageModal" ${DA('click', String(s.invoiceImageUrl), String(s.similarInvoiceImage.imageUrl), (s.similarInvoiceImage.similarity))}>🖼️ قارن الصورتين</button>
        </div>` : ''}
  `;
}
function reviewActionsHtml(s, isRejecting){
  return isRejecting ? `
        <div class="field sx-85">
          <textarea id="rejectReason_${s.id}" rows="2" placeholder="اكتب سبب الرفض هنا... (3 أحرف على الأقل)"></textarea>
        </div>
        <div class="review-actions">
          <button class="btn danger sm" data-click="confirmRejectSale" ${DA('click', String(s.id))}>تأكيد الرفض</button>
          <button class="btn ghost sm" data-click="cancelReject">إلغاء</button>
        </div>` : `
        <div class="review-actions">
          <button class="btn approve sm" data-click="approveSale" ${DA('click', String(s.id))}>✓ قبول</button>
          <button class="btn danger sm" data-click="startReject" ${DA('click', String(s.id))}>✕ رفض</button>
        </div>`;
}
function reviewCardHtml(s, showDept){
  const p = s.pharmacist;
  const isRejecting = rejectingId === s.id;
  const isComp = s.saleType==='ASIL' || s.saleType==='ZAROZA';
  return `
      <div class="review-card">
        <div class="review-top">
          ${s.invoiceImageUrl ? `<img class="review-thumb" src="${s.invoiceImageUrl}" data-click="openImageModal" ${DA('click', String(s.invoiceImageUrl), invoiceFileName(s))}>` : ''}
          <div class="review-info">
            <div class="n">${esc(p ? p.pharmacyName : '')} ${isComp ? `<span class="badge sx-86">${saleModeLabel(s.saleType)}</span>` : ''} ${showDept ? `<span class="badge sx-86">${deptLabel(s.department)}</span>` : ''}</div>
            ${reviewInfoHtml(s, isComp)}
            <div class="m sx-87">رقم الفاتورة: <b class="num sx-32">${esc(s.invoiceNumber || '—')}</b> · أُرسلت: ${fmtDate(s.createdAt)}</div>
          </div>
        </div>
        ${reviewWarningsHtml(s)}
        ${reviewActionsHtml(s, isRejecting)}
      </div>`;
}

function renderReviewQueue(){
  const showDept = !!adminPharmacistFilter;
  const pendingSales = (adminSalesCache||[]).filter(s=>s.status==='PENDING').sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
  return `
  <div class="admin-section">
    <div class="section-title">مراجعة الفواتير ${pendingSales.length>0 ? `<span class="badge pending sx-88">${pendingSales.length}</span>` : ''}</div>
    ${pendingSales.length===0 ? `<div class="empty-state"><div class="ic">✅</div><div class="t">لا توجد فواتير بانتظار المراجعة</div></div>` : `
    ${pendingSales.map(s => reviewCardHtml(s, showDept)).join('')}
    `}
  </div>`;
}

async function approveSale(id){
  try{
    await apiRequest('/sales/' + id + '/review', { method:'PATCH', json:{ status:'APPROVED' } });
    toast('تم قبول العملية وتأكيد العمولة');
    await loadAdminSales();
    render();
  }catch(e){ toast(e.message, 'danger'); }
}
function startReject(id){ rejectingId = id; render(); }
function cancelReject(){ rejectingId = null; render(); }
async function confirmRejectSale(id){
  const ta = document.getElementById('rejectReason_'+id);
  const reason = ta ? ta.value.trim() : '';
  if(!reason){ toast('الرجاء كتابة سبب الرفض', 'danger'); return; }
  if(reason.length < 3){ toast('سبب الرفض يجب أن يكون 3 أحرف على الأقل', 'danger'); return; }
  try{
    await apiRequest('/sales/' + id + '/review', { method:'PATCH', json:{ status:'REJECTED', rejectionReason: reason } });
    rejectingId = null;
    toast('تم رفض العملية');
    await loadAdminSales();
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

async function reviewPharmacist(id){
  adminPharmacistFilter = id;
  activeTab = 'admin';
  adminSalesCache = null;
  render();
  try{ await loadAdminSales(); render(); }catch(e){ toast(e.message, 'danger'); }
}
async function clearPharmacistFilter(){
  adminPharmacistFilter = null;
  adminSalesCache = null;
  render();
  try{ await loadAdminSales(); render(); }catch(e){ toast(e.message, 'danger'); }
}

/* -------------------- تبويب: لوحة تحكم الأدمن -------------------- */
function tabAdmin(){
  if(adminSalesCache===null){
    return `<p class="sx-43">جارِ التحميل...</p>`;
  }
  const filterBanner = adminPharmacistFilter ? `
  <div class="otp-banner sx-27">
    <span>تعرض فواتير صيدلي محدد (من صفحة الدفعات) — بالقسمين</span>
    <button class="btn ghost sm sx-22" data-click="clearPharmacistFilter">عودة للوحة</button>
  </div>` : '';

  return `
  ${filterBanner}
  ${renderReviewQueue()}
  `;
}

/* -------------------- تبويب: رسائل جماعية (SMS) -------------------- */

// تقدير عدد رسائل الـ SMS: النص العربي بيُرسل بترميز UCS-2 (٧٠ حرف بالرسالة الواحدة،
// ٦٧ حرف لكل جزء لو انقسم لعدة رسائل) — تقدير تقريبي لعرضه للأدمن فقط، مش حساب دقيق 100%.
function estimateSmsSegments(text){
  const len = Array.from(text || '').length;
  const isGsm7 = /^[\x00-\x7F]*$/.test(text || '');
  const singleLimit = isGsm7 ? 160 : 70;
  const multiLimit = isGsm7 ? 153 : 67;
  if(len === 0) return { len:0, segments:0 };
  const segments = len <= singleLimit ? 1 : Math.ceil(len / multiLimit);
  return { len, segments };
}
function messageCharCountLabel(text){
  const { len, segments } = estimateSmsSegments(text);
  if(len === 0) return 'بانتظار كتابة الرسالة...';
  return `${len} حرف — تقريبًا ${segments} رسالة SMS`;
}
function onMessageTextInput(value){
  messagesDraft.text = value;
  const el = document.getElementById('msgCharCount');
  if(el) el.textContent = messageCharCountLabel(value);
}

function activePharmacistsSorted(){
  return (pharmacistsCache||[]).filter(p=>p.isActive)
    .slice().sort((a,b)=>(a.pharmacyName||'').localeCompare(b.pharmacyName||'', 'ar'));
}
// لائحة الصيادلة المطابقين للفلتر الحالي (منطقة أو صيدلية محددة، والاثنين يندمجوا مع بعض)
function computeMessageMatchedList(){
  const activeList = activePharmacistsSorted();
  if(messagesState.allPharmacists) return activeList;
  if(messagesState.cities.length===0 && messagesState.pharmacistIds.length===0) return [];
  return activeList.filter(p => messagesState.cities.includes(p.city) || messagesState.pharmacistIds.includes(p.id));
}

function toggleMessageCity(city){
  const i = messagesState.cities.indexOf(city);
  if(i>=0) { messagesState.cities.splice(i,1); } else { messagesState.cities.push(city); }
  render();
}
function toggleMessageAllPharmacists(){
  messagesState.allPharmacists = !messagesState.allPharmacists;
  render();
}
function toggleMessagePharmacist(id){
  const i = messagesState.pharmacistIds.indexOf(id);
  if(i>=0) { messagesState.pharmacistIds.splice(i,1); } else { messagesState.pharmacistIds.push(id); }
  render();
}
function clearMessagePharmacists(){
  messagesState.pharmacistIds = [];
  render();
}
// بحث داخل قائمة الصيدليات المحددة يدويًا — بيحدّث القائمة مباشرة بدون render() كامل
// حتى ما ينفلت فوكس صندوق الكتابة (نفس فكرة فلترة صندوق البحث بتقارير العمولات)
function onMessagePharmacistSearch(value){
  messagesState.pharmacistSearch = value;
  const listEl = document.getElementById('msgPharmacistList');
  if(listEl) listEl.innerHTML = renderMessagePharmacistOptions();
}
function renderMessagePharmacistOptions(){
  const activeList = activePharmacistsSorted();
  const q = (messagesState.pharmacistSearch||'').trim();
  const filtered = q ? activeList.filter(p=> (p.pharmacyName||'').includes(q) || (p.fullName||'').includes(q)) : activeList;
  if(filtered.length===0) return `<div class="combo-empty">لا يوجد نتائج</div>`;
  return filtered.map(p=>`
    <label class="sx-89">
      <input type="checkbox" class="sx-90" ${messagesState.pharmacistIds.includes(p.id)?'checked':''} data-change="toggleMessagePharmacist" ${DA('change', String(p.id))}>
      <span class="sx-26">${esc(p.pharmacyName)}</span><span class="sx-91">${esc(p.city||'')}</span>
    </label>`).join('');
}

// المرحلة 1: يتحقق من المحتوى ويعرض ملخص المراجعة (لسا ما انبعت أي رمز ولا رسالة)
function startMessageSend(){
  const textEl = document.getElementById('msgCampaignText');
  const nameEl = document.getElementById('msgCampaignName');
  if(textEl) { messagesDraft.text = textEl.value; }
  if(nameEl) { messagesDraft.name = nameEl.value; }
  const text = messagesDraft.text.trim();
  const name = messagesDraft.name.trim();
  if(text.length < 3){ toast('اكتب نص رسالة أطول قليلاً (٣ أحرف على الأقل)', 'danger'); return; }
  const matched = computeMessageMatchedList();
  if(matched.length===0){ toast('لا يوجد صيادلة مطابقين لهذا الفلتر حاليًا', 'danger'); return; }
  messagesPendingSend = {
    stage: 'review',
    name, text,
    cities: [...messagesState.cities],
    pharmacistIds: [...messagesState.pharmacistIds],
    allPharmacists: messagesState.allPharmacists,
    count: matched.length,
    challengeToken: null, maskedPhone: '', expiresAtMs: 0,
  };
  render();
}
// إلغاء = رجوع للتعديل (المسودة والفلاتر بتضل زي ما هي)
function cancelMessageSend(){ messagesPendingSend = null; render(); }

// المرحلة 2: طلب رمز الاعتماد (بيروح لهاتف الإدارة، صالح ١٠ دقائق). كمان بيُستخدم لإعادة إرسال الرمز.
async function requestMessageApproval(){
  const p = messagesPendingSend;
  if(!p || messagesSending) return;
  messagesSending = true; render();
  try{
    const res = await apiRequest('/messages/campaigns/request-approval', { method:'POST', json:{
      text: p.text, cities: p.cities, pharmacistIds: p.pharmacistIds, allPharmacists: p.allPharmacists,
    }});
    p.stage = 'code';
    p.challengeToken = res.data.challengeToken;
    p.maskedPhone = res.data.maskedPhone;
    p.count = res.data.recipientCount;
    p.expiresAtMs = Date.now() + res.data.expiresInMinutes * 60 * 1000;
    toast('انبعت رمز الاعتماد لهاتف الإدارة');
  }catch(e){
    toast(e.message, 'danger');
  }finally{
    messagesSending = false;
    render();
  }
}

// المرحلة 3: إدخال الرمز → الإرسال الفعلي (السيرفر بيرفض أي إرسال بدون رمز صحيح لنفس المحتوى)
async function confirmMessageSend(){
  const p = messagesPendingSend;
  if(p?.stage!=='code' || messagesSending) return;
  const codeEl = document.getElementById('msgApprovalCode');
  const code = codeEl ? codeEl.value.trim() : '';
  if(!/^\d{6}$/.test(code)){ toast('أدخل رمز الاعتماد المكوّن من ٦ أرقام', 'danger'); return; }
  messagesSending = true; render();
  try{
    const payload = {
      text: p.text, cities: p.cities, pharmacistIds: p.pharmacistIds, allPharmacists: p.allPharmacists,
      challengeToken: p.challengeToken, code,
    };
    if(p.name) { payload.name = p.name; }
    const res = await apiRequest('/messages/campaigns', { method:'POST', json:payload });
    messagesLastResult = res.data;
    messagesCampaignDetailCache[res.data.id] = res.data;
    toast(`بدأ إرسال الحملة "${res.data.name}" لـ ${res.data.totalRecipients} صيدلية — بتتابع نتيجتها هون تلقائيًا`);
    messagesPendingSend = null;
    messagesState = defaultMessagesState();
    messagesDraft = { name:'', text:'' };
    messagesCampaignsCache = null;
    await loadMessageCampaigns();
  }catch(e){
    toast(e.message, 'danger'); // رمز غلط/منتهي: بنضل بمرحلة إدخال الرمز عشان يعيد المحاولة أو يطلب رمز جديد
  }finally{
    messagesSending = false;
    render();
  }
  // تشغيل المتابعة بالخلفية عن قصد بدون انتظار (لو انتظرناها بيضل الزر بحالة "جارِ الإرسال" حتى ١٠ دقائق).
  // pollMessageCampaign بتلتقط كل أخطائها داخليًا (try/catch/finally) فما بترجع Promise مرفوض أبدًا.
  if(messagesLastResult) void pollMessageCampaign(messagesLastResult.id);
}

// الإرسال بيصير بالخلفية بالسيرفر → بنتابع تقدّم الحملة كل ٣ ثواني ونحدّث الصندوقين المعنيين مباشرة
// (بدون render() كامل، عشان ما نقطع الكتابة أو إدخال الرمز لو الأدمن عم يجهّز حملة ثانية)
const messagePollers = new Set();
function messageCampaignInProgress(c){
  const k = c?.counts || {};
  return (k.PENDING||0) + (k.SENDING||0) > 0;
}
function refreshMessageProgressDom(){
  const box = document.getElementById('msgLastResultBox');
  if(box) { box.innerHTML = renderMessagesLastResultInner(); }
  const hist = document.getElementById('msgHistoryWrap');
  if(hist) hist.innerHTML = renderMessagesCampaignsList();
}
async function pollMessageCampaign(id){
  if(messagePollers.has(id)) return;
  messagePollers.add(id);
  try{
    for(let i=0; i<200; i++){ // سقف ~١٠ دقائق
      await new Promise(r => setTimeout(r, 3000));
      if(!currentUser || activeTab!=='messages') break;
      const res = await apiRequest('/messages/campaigns/'+id);
      const d = res.data;
      messagesCampaignDetailCache[id] = d;
      if(messagesLastResult?.id===id) { messagesLastResult = d; }
      const row = (messagesCampaignsCache||[]).find(x=>x.id===id);
      if(row) { row.counts = d.counts; }
      refreshMessageProgressDom();
      if(!messageCampaignInProgress(d)) break;
    }
  }catch(e){ /* انقطاع مؤقت: بيتحدّث عند فتح التبويب من جديد */ }
  finally{ messagePollers.delete(id); }
}

async function loadMessageCampaigns(){
  const res = await apiRequest('/messages/campaigns');
  messagesCampaignsCache = res.data;
}

async function toggleMessageCampaignDetail(id){
  if(messagesExpandedCampaignId === id){ messagesExpandedCampaignId = null; render(); return; }
  messagesExpandedCampaignId = id;
  render();
  if(!messagesCampaignDetailCache[id]){
    try{
      const res = await apiRequest('/messages/campaigns/'+id);
      messagesCampaignDetailCache[id] = res.data;
      render();
    }catch(e){ toast(e.message, 'danger'); }
  }
}

// 🟢 تم التسليم لسا معطّلة فعليًا (بانتظار ربط مزود SMS بيدعم تقارير التسليم) — الشكل جاهز بالكامل
function messageStatusBadge(status){
  if(status==='DELIVERED') return `<span class="badge ok">🟢 تم التسليم</span>`;
  if(status==='SENT') return `<span class="badge pending">📤 تم الإرسال</span>`;
  if(status==='FAILED') return `<span class="badge rejected">✕ فشل</span>`;
  if(status==='SENDING') return `<span class="badge pending">📨 جارِ الإرسال</span>`;
  return `<span class="badge pending">⏳ بالانتظار</span>`;
}

function campaignRowHtml(c){
      const counts = c.counts || {};
      const preview = (c.text||'').length>60 ? esc(c.text.slice(0,60))+'…' : esc(c.text||'');
  return `<tr>
          <td><b>${esc(c.name)}</b></td>
          <td class="sx-92">${preview}</td>
          <td class="num">${c.totalRecipients}</td>
          <td class="num">${(counts.PENDING||0)+(counts.SENDING||0)}</td>
          <td class="num">${counts.DELIVERED||0}</td>
          <td class="num">${counts.SENT||0}</td>
          <td class="num">${counts.FAILED||0}</td>
          <td>${fmtDate(c.createdAt)}</td>
          <td><button class="btn ghost sm" data-click="toggleMessageCampaignDetail" ${DA('click', String(c.id))}>${messagesExpandedCampaignId===c.id ? 'إخفاء' : 'التفاصيل'}</button></td>
        </tr>`;
}
function campaignExpandedHtml(c){
  if(messagesExpandedCampaignId !== c.id) return '';
  const detail = messagesCampaignDetailCache[c.id];
  if(!detail?.recipients){
    return `<tr><td colspan="9" class="sx-93">جارِ التحميل...</td></tr>`;
  }
  return `<tr><td colspan="9" class="sx-94">
          <div class="sx-95">نص الرسالة الكامل:</div>
          <div class="sx-96">${esc(c.text)}</div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>الصيدلية</th><th>رقم الهاتف</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
              <tbody>
              ${detail.recipients.map(r=>`<tr>
                <td>${esc(r.pharmacyName)}</td>
                <td class="num">${esc(r.phoneNumber)}</td>
                <td>${messageStatusBadge(r.status)}</td>
                <td class="sx-97">${esc(r.errorMessage || '—')}</td>
              </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </td></tr>`;
}

function renderMessagesCampaignsList(){
  const list = messagesCampaignsCache || [];
  if(list.length===0) return `<div class="empty-state"><div class="ic">📨</div><div class="t">ما في حملات مُرسلة بعد</div></div>`;
  return `
  <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>الحملة</th><th>نص الرسالة</th><th class="num">المستلمون</th><th class="num">⏳ جارٍ</th><th class="num">🟢 تسليم</th><th class="num">📤 إرسال</th><th class="num">✕ فشل</th><th>التاريخ</th><th></th></tr></thead>
      <tbody>
      ${list.map(c => campaignRowHtml(c) + campaignExpandedHtml(c)).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderMessagesLastResultInner(){
  const r = messagesLastResult;
  if(!r || messagesPendingSend) return '';
  const k = r.counts || {};
  const inProgress = (k.PENDING||0) + (k.SENDING||0);
  const done = (r.totalRecipients||0) - inProgress;
  const pct = r.totalRecipients ? Math.round(done / r.totalRecipients * 100) : 100;
  return `
  <div class="sx-98">
    <div class="sx-99">${inProgress ? '⏳ جارِ الإرسال' : '✅ انتهى الإرسال'} — ${esc(r.name)}</div>
    <div class="sx-100">
      <div class="sx-progress-fill sx-w-${pct}"></div>
    </div>
    <div class="sx-101">
      تمت معالجة <b>${done}</b> من <b>${r.totalRecipients}</b> ·
      📤 تم الإرسال: <b>${k.SENT||0}</b> ·
      ✕ فشل: <b>${k.FAILED||0}</b>
    </div>
  </div>`;
}

function messagesCityOptionsHtml(filtersDisabled){
  return JORDAN_CITIES.map(c=>`
        <label class="sx-city-chip ${messagesState.cities.includes(c)?'sx-city-chip-on':'sx-city-chip-off'}">
          <input type="checkbox" class="sx-90" ${messagesState.cities.includes(c)?'checked':''} ${filtersDisabled?'disabled':''} data-change="toggleMessageCity" ${DA('change', String(c))}> ${c}
        </label>`).join('');
}
function messagesReviewStageHtml(summary){
  return `
      <div class="sx-98">
        <div class="sx-95">مراجعة قبل الإرسال — الخطوة ١ من ٢</div>
        ${summary}
        <div class="sx-102">للأمان، الإرسال ما بيتم إلا بعد إدخال رمز اعتماد بينبعت لهاتف الإدارة (صالح ١٠ دقائق).</div>
        <div class="sx-25">
          <button class="btn approve sm" ${messagesSending?'disabled':''} data-click="requestMessageApproval">${messagesSending?'جارِ الإرسال...':'إرسال رمز الاعتماد لهاتف الإدارة'}</button>
          <button class="btn ghost sm" ${messagesSending?'disabled':''} data-click="cancelMessageSend">رجوع للتعديل</button>
        </div>
      </div>`;
}
function messagesApprovalStageHtml(p, summary){
  const expired = Date.now() > p.expiresAtMs;
  const untilTxt = new Date(p.expiresAtMs).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
  return `
      <div class="sx-98">
        <div class="sx-95">أدخل رمز الاعتماد — الخطوة ٢ من ٢</div>
        ${summary}
        <div class="sx-103">
          ${expired
            ? `<span class="sx-104">انتهت صلاحية الرمز، اطلب رمزًا جديدًا.</span>`
            : `انبعت رمز من ٦ أرقام لهاتف الإدارة <b dir="ltr">${esc(p.maskedPhone)}</b> — صالح لحد الساعة <b dir="ltr">${untilTxt}</b>.`}
        </div>
        <input type="text" id="msgApprovalCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="------" dir="ltr"
               class="sx-105" ${expired?'disabled':''}>
        <div class="sx-25">
          <button class="btn approve sm" ${(messagesSending||expired)?'disabled':''} data-click="confirmMessageSend">${messagesSending?'جارِ الإرسال...':'تأكيد وإرسال الآن'}</button>
          <button class="btn ghost sm" ${messagesSending?'disabled':''} data-click="requestMessageApproval">إعادة إرسال الرمز</button>
          <button class="btn ghost sm" ${messagesSending?'disabled':''} data-click="cancelMessageSend">رجوع للتعديل</button>
        </div>
      </div>`;
}
function messagesConfirmBoxHtml(){
  const p = messagesPendingSend;
  if(!p) return '';
  const summary = `
  <div>رح ترسل الرسالة التالية لـ <b>${p.count}</b> صيدلية:</div>
  <div class="sx-106">${esc(p.text)}</div>`;
  return p.stage === 'review' ? messagesReviewStageHtml(summary) : messagesApprovalStageHtml(p, summary);
}

function tabMessages(){
  if(pharmacistsCache===null || messagesCampaignsCache===null){
    return `<p class="sx-43">جارِ التحميل...</p>`;
  }

  const matchedCount = computeMessageMatchedList().length;

  const filtersDisabled = messagesState.allPharmacists;

  return `
  <div class="section-title">رسائل جماعية (SMS)</div>
  <div class="otp-banner sx-27">
    <span>ملاحظة: خدمة الرسائل النصية لسا ما انربطت بمزود حقيقي — كل الرسائل حاليًا رح تنسجل بحالة "فشل الإرسال". حالة "🟢 تم التسليم" جاهزة بالشكل وبتشتغل تلقائيًا فور ربط مزود SMS يدعم تقارير التسليم.</span>
  </div>

  <div class="admin-section">
    <div class="section-title">إنشاء حملة جديدة</div>

    <div class="field">
      <label>المناطق (اختياري، تقدر تحدد أكثر من منطقة — تندمج مع تحديد الصيدليات تحت)</label>
      <div class="sx-107">
        ${messagesCityOptionsHtml(filtersDisabled)}
      </div>
    </div>

    <div class="field">
      <label>صيدليات محددة (اختياري، بتنضاف فوق فلتر المناطق)</label>
      <input type="text" placeholder="ابحث باسم الصيدلية..." value="${esc(messagesState.pharmacistSearch)}" ${filtersDisabled?'disabled':''} data-input="onMessagePharmacistSearch" data-input-pass="value">
      <div id="msgPharmacistList" class="sx-pharmacist-list ${filtersDisabled?'sx-pharmacist-list-disabled':''}">
        ${renderMessagePharmacistOptions()}
      </div>
      ${messagesState.pharmacistIds.length ? `<button class="link-btn sx-108" data-click="clearMessagePharmacists">إلغاء التحديد اليدوي (${messagesState.pharmacistIds.length})</button>` : ''}
    </div>

    <div class="field">
      <label class="sx-109">
        <input type="checkbox" class="sx-90" ${messagesState.allPharmacists?'checked':''} data-change="toggleMessageAllPharmacists">
        إرسال لكل الصيادلة (بيتجاوز فلتري المناطق والصيدليات فوق)
      </label>
    </div>

    <div class="otp-banner sx-27">
      <span>عدد المستلمين المطابقين حاليًا: <b>${matchedCount}</b> صيدلية (الصيادلة الموقوفين مستثنون تلقائيًا)</span>
    </div>

    <div class="field">
      <label>اسم الحملة (اختياري — لو تركته فاضي بيتسمّى تلقائيًا "حملة رقم N")</label>
      <input type="text" id="msgCampaignName" placeholder="مثلاً: تذكير موعد التسليم" maxlength="80" value="${esc(messagesDraft.name)}" data-input="setMessagesDraftName" data-input-pass="value">
    </div>

    <div class="field">
      <label>نص الرسالة</label>
      <textarea id="msgCampaignText" rows="4" maxlength="1000" placeholder="اكتب نص الرسالة هنا..." data-input="onMessageTextInput" data-input-pass="value">${esc(messagesDraft.text)}</textarea>
      <div id="msgCharCount" class="sx-110">${messageCharCountLabel(messagesDraft.text)}</div>
    </div>

    ${!messagesPendingSend ? `<button class="btn" data-click="startMessageSend">إرسال الرسالة</button>` : ''}
    ${messagesConfirmBoxHtml()}
    <div id="msgLastResultBox">${renderMessagesLastResultInner()}</div>
  </div>

  <div class="admin-section">
    <div class="section-title">سجل الحملات السابقة</div>
    <div id="msgHistoryWrap">${renderMessagesCampaignsList()}</div>
  </div>
  `;
}

/* -------------------- تبويب: إدارة الأصناف -------------------- */
function tabCategoriesMgmt(){
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  if(isSuperAdmin && adminDeptFilter===''){
    return `
    <div class="section-title">إدارة الأصناف</div>
    <div class="empty-state">
      <div class="ic">🗂️</div>
      <div class="t">اختر قسم محدد لإدارة أصنافه</div>
      <div class="d">استخدم قائمة "عرض بيانات قسم" بأعلى الصفحة (الأدوية أو الكوزمتك)</div>
    </div>`;
  }
  const dep = isSuperAdmin ? adminDeptFilter : currentUser.department;
  const isCosmetics = dep === 'COSMETICS';
  const subTabClass = key => catMgmtSubTab===key ? '' : 'ghost';

  return `
  <div class="admin-section">
    <div class="section-title">إدارة أصناف قسم ${isSuperAdmin ? deptLabel(dep) : ''}</div>
    ${isCosmetics ? `
    <div class="sx-111">
      <button class="btn sm ${subTabClass('NORMAL')}" data-click="switchCatMgmtSubTab" data-click-args="[&quot;NORMAL&quot;]">الأصناف العادية</button>
      <button class="btn sm ${subTabClass('ASIL')}" data-click="switchCatMgmtSubTab" data-click-args="[&quot;ASIL&quot;]">أصناف تعويض الأصيل</button>
      <button class="btn sm ${subTabClass('ZAROZA')}" data-click="switchCatMgmtSubTab" data-click-args="[&quot;ZAROZA&quot;]">أصناف تعويض زاروزا</button>
    </div>` : ''}
    ${(!isCosmetics || catMgmtSubTab==='NORMAL') ? renderNormalCategoriesMgmt() : renderCompensationItemsMgmt(catMgmtSubTab)}
  </div>
  `;
}

function renderNormalCategoriesMgmt(){
  return `
  ${CATEGORIES.map(c=>{
    if(editingCategoryId === c.id){
      return `
      <div class="cat-mgmt-row sx-23">
        <div class="field sx-112">
          <label>اسم الصنف</label>
          <input type="text" id="editCatName_${c.id}" value="${esc(c.name)}">
        </div>
        <div class="field">
          <label>قيمة العمولة لكل قطعة (دينار)</label>
          <input type="number" id="editCatPrice_${c.id}" min="0" step="0.01" value="${c.commissionPerUnit}">
        </div>
        <div class="sx-113">
          <button class="btn accent sm" data-click="saveEditCategory" ${DA('click', String(c.id))}>حفظ</button>
          <button class="btn ghost sm" data-click="cancelEditCategory">إلغاء</button>
        </div>
      </div>`;
    }
    return `
    <div class="cat-mgmt-row">
      <div>
        <div class="n">${esc(c.name)} ${c.isActive===false ? '<span class="badge rejected sx-114">غير مفعّل</span>' : ''}</div>
        <div class="p">${fmtMoney(c.commissionPerUnit)} دينار لكل قطعة</div>
      </div>
      <div class="sx-115">
        <button class="btn ghost sm" data-click="startEditCategory" ${DA('click', String(c.id))}>✏️ تعديل</button>
        ${c.isActive===false
          ? `<button class="btn ghost sm" data-click="reactivateCategory" ${DA('click', String(c.id))}>تفعيل</button>`
          : `<button class="btn danger sm" data-click="deleteCategory" ${DA('click', String(c.id))}>حذف</button>`}
      </div>
    </div>
  `;
  }).join('')}
  <div class="field sx-116">
    <label>اسم الصنف</label>
    <input type="text" id="newCatName" placeholder="مثال: فيتامين-سي">
  </div>
  <div class="field">
    <label>قيمة العمولة لكل قطعة (دينار)</label>
    <input type="number" id="newCatPrice" min="0" step="0.01" placeholder="مثال: 1">
  </div>
  <button class="btn accent" data-click="addCategory">إضافة الصنف</button>
  `;
}

function startEditCategory(id){
  editingCategoryId = id;
  render();
}
function cancelEditCategory(){
  editingCategoryId = null;
  render();
}

async function saveEditCategory(id){
  const name = document.getElementById('editCatName_'+id).value.trim();
  const price = Number.parseFloat(document.getElementById('editCatPrice_'+id).value);
  if(!name){ toast('الرجاء إدخال اسم الصنف', 'danger'); return; }
  if(Number.isNaN(price) || price <= 0){ toast('الرجاء إدخال قيمة عمولة صحيحة', 'danger'); return; }

  const dep = currentDepartmentParam();
  try{
    await apiRequest('/categories/' + id, { method:'PATCH', json:{ name, commissionPerUnit: price, ...(dep?{department:dep}:{}) } });
    toast('تم تحديث الصنف بنجاح');
    editingCategoryId = null;
    await loadCategories();
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

async function addCategory(){
  const name = document.getElementById('newCatName').value.trim();
  const price = Number.parseFloat(document.getElementById('newCatPrice').value);
  if(!name){ toast('الرجاء إدخال اسم الصنف', 'danger'); return; }
  if(Number.isNaN(price) || price <= 0){ toast('الرجاء إدخال قيمة عمولة صحيحة', 'danger'); return; }

  const dep = currentDepartmentParam();
  try{
    await apiRequest('/categories', { method:'POST', json:{ name, commissionPerUnit: price, ...(dep?{department:dep}:{}) } });
    toast('تمت إضافة الصنف');
    await loadCategories();
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

async function deleteCategory(id){
  const dep = currentDepartmentParam();
  try{
    await apiRequest('/categories/' + id + (dep?('?department='+dep):''), { method:'DELETE' });
    toast('تم إلغاء تفعيل الصنف');
    await loadCategories();
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

async function reactivateCategory(id){
  const dep = currentDepartmentParam();
  try{
    await apiRequest('/categories/' + id, { method:'PATCH', json:{ isActive:true, ...(dep?{department:dep}:{}) } });
    toast('تم تفعيل الصنف');
    await loadCategories();
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

/* -------------------- إدارة أصناف تعويض الأصيل / زاروزا (تبويب فرعي بإدارة الأصناف) -------------------- */
async function switchCatMgmtSubTab(t){
  catMgmtSubTab = t;
  render();
  if(t !== 'NORMAL' && !compensationItemsCache[t]){
    try{
      await loadCompensationItemsAdmin(t);
      render();
    }catch(e){ toast(e.message, 'danger'); }
  }
}

async function loadCompensationItemsAdmin(type){
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const dep = isSuperAdmin ? adminDeptFilter : currentUser.department;
  const qs = '?type=' + type + (dep ? ('&department=' + dep) : '');
  const res = await apiRequest('/compensation-items' + qs);
  compensationItemsCache[type] = res.data;
}

function renderCompensationItemsMgmt(type){
  const items = compensationItemsCache[type];
  const title = type==='ASIL' ? 'أصناف تعويض الأصيل' : 'أصناف تعويض زاروزا';
  if(items===null || items===undefined){
    return `<p class="sx-43">جارِ تحميل ${title}...</p>`;
  }
  return `
  ${items.length===0 ? `<div class="empty-state"><div class="ic">🗂️</div><div class="t">لا توجد أصناف بعد</div></div>` : ''}
  ${items.map(c=>`
    <div class="cat-mgmt-row">
      <div>
        <div class="n">${esc(c.name)} ${c.isActive===false ? '<span class="badge rejected sx-114">غير مفعّل</span>' : ''}</div>
        <div class="p">${fmtMoney(c.price)} دينار</div>
      </div>
      ${c.isActive===false
        ? `<button class="btn ghost sm" data-click="reactivateCompensationItem" ${DA('click', String(c.id), String(type))}>تفعيل</button>`
        : `<button class="btn danger sm" data-click="deleteCompensationItem" ${DA('click', String(c.id), String(type))}>حذف</button>`}
    </div>
  `).join('')}
  <div class="field sx-116">
    <label>اسم الصنف</label>
    <input type="text" id="newCompItemName_${type}" placeholder="مثال: فيس ميلك">
  </div>
  <div class="field">
    <label>السعر (دينار)</label>
    <input type="number" id="newCompItemPrice_${type}" min="0" step="0.01" placeholder="مثال: 15">
  </div>
  <button class="btn accent" data-click="addCompensationItem" ${DA('click', String(type))}>إضافة الصنف</button>
  `;
}

async function addCompensationItem(type){
  const name = document.getElementById('newCompItemName_'+type).value.trim();
  const price = Number.parseFloat(document.getElementById('newCompItemPrice_'+type).value);
  if(!name){ toast('الرجاء إدخال اسم الصنف', 'danger'); return; }
  if(Number.isNaN(price) || price <= 0){ toast('الرجاء إدخال سعر صحيح', 'danger'); return; }
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const dep = isSuperAdmin ? adminDeptFilter : currentUser.department;
  try{
    await apiRequest('/compensation-items', { method:'POST', json:{ name, price, type, ...(dep?{department:dep}:{}) } });
    toast('تمت إضافة الصنف');
    await loadCompensationItemsAdmin(type);
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

async function deleteCompensationItem(id, type){
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const dep = isSuperAdmin ? adminDeptFilter : currentUser.department;
  try{
    await apiRequest('/compensation-items/' + id + (dep?('?department='+dep):''), { method:'DELETE' });
    toast('تم إلغاء تفعيل الصنف');
    await loadCompensationItemsAdmin(type);
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

async function reactivateCompensationItem(id, type){
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const dep = isSuperAdmin ? adminDeptFilter : currentUser.department;
  try{
    await apiRequest('/compensation-items/' + id, { method:'PATCH', json:{ isActive:true, ...(dep?{department:dep}:{}) } });
    toast('تم تفعيل الصنف');
    await loadCompensationItemsAdmin(type);
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

/* -------------------- تبويب: حسابي (تغيير كلمة سر الأدمن) -------------------- */
function tabAccount(){
  return `
  <div class="section-title">حسابي</div>
  <div class="admin-section">
    <div class="sx-117"><b>${esc(currentUser.fullName)}</b> · اسم المستخدم: <span class="num">${esc(currentUser.username)}</span></div>
    <div class="section-title sx-82">تغيير كلمة السر</div>
    ${accountMsg ? `<div class="otp-banner sx-49"><span>${esc(accountMsg)}</span></div>` : ''}
    <div class="field"><label>كلمة السر الحالية</label><input type="password" id="accCurPass" autocomplete="current-password"></div>
    <div class="field"><label>كلمة السر الجديدة</label><input type="password" id="accNewPass" autocomplete="new-password" placeholder="10 أحرف على الأقل، فيها حرف إنجليزي ورقم"></div>
    <div class="field"><label>تأكيد كلمة السر الجديدة</label><input type="password" id="accNewPass2" autocomplete="new-password"></div>
    <button class="btn" id="accSaveBtn" data-click="submitAdminPasswordChange">حفظ كلمة السر</button>
    <p class="sx-118">بعد التغيير بتنتهي كل الجلسات القديمة لهذا الحساب على أي جهاز آخر.</p>
  </div>`;
}

async function submitAdminPasswordChange(){
  const cur = document.getElementById('accCurPass').value;
  const n1 = document.getElementById('accNewPass').value;
  const n2 = document.getElementById('accNewPass2').value;
  if(!cur){ toast('أدخل كلمة السر الحالية', 'danger'); return; }
  if(n1.length < 10 || !/[A-Za-z]/.test(n1) || !/\d/.test(n1)){ toast('كلمة السر الجديدة: 10 أحرف على الأقل وفيها حرف إنجليزي ورقم', 'danger'); return; }
  if(n1 !== n2){ toast('كلمتا السر غير متطابقتين', 'danger'); return; }
  const btn = document.getElementById('accSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارِ الحفظ...'; }
  try{
    await apiRequest('/auth/admin/change-password', { method:'POST', json:{ currentPassword: cur, newPassword: n1 } });
    // السيرفر حط كوكي جلسة جديدة بنفس الرد تلقائيًا (tokenVersion تغيّر فألغى الجلسة القديمة)
    accountMsg = 'تم تغيير كلمة السر بنجاح ✓';
    toast('تم تغيير كلمة السر بنجاح');
    render();
  }catch(e){
    toast(e.message, 'danger');
    if(btn){ btn.disabled = false; btn.textContent = 'حفظ كلمة السر'; }
  }
}

/* -------------------- تبويب: العملاء المسجلون -------------------- */
function tabPharmacists(){
  return `
  <div class="section-title">العملاء المسجلون حسب المنطقة</div>
  <div class="admin-section">
    <select id="statsCity">
      <option value="" ${statsFilter.city===''?'selected':''}>كل المناطق</option>
      ${JORDAN_CITIES.map(c=>`<option value="${c}" ${statsFilter.city===c?'selected':''}>${c}</option>`).join('')}
    </select>
    <button class="btn sx-37" data-click="runStatsFilter">عرض</button>

    ${statsFilterActive ? renderStatsResults() : ''}
  </div>
  `;
}

function runStatsFilter(){
  statsFilter.city = document.getElementById('statsCity').value;
  statsFilterActive = true;
  render();
}

function renderStatsResults(){
  const list = (pharmacistsCache||[]).filter(u => statsFilter.city==='' || u.city===statsFilter.city);
  const label = statsFilter.city || 'كل المناطق';

  return `
  <div class="sx-119">
    <div class="stat-grid one">
      <div class="stat-card"><div class="v num">${list.length}</div><div class="l">عميل مسجّل — ${label}</div></div>
    </div>
    ${list.length===0 ? `<div class="empty-state"><div class="ic">👤</div><div class="t">لا يوجد صيادلة مسجّلون</div><div class="d">في ${label}</div></div>` : `
    <div class="sx-120">
      <button class="export-btn" data-click="exportPharmacistsToExcel">⬇ تصدير Excel</button>
      <button class="export-btn" data-click="printPharmacistsPDF">🖨️ تصدير PDF</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>الاسم</th><th>رقم الهاتف</th><th>الصيدلية</th><th>المدينة</th><th>المنطقة</th><th>الحالة</th></tr></thead>
        <tbody>
        ${list.map(u=>`<tr>
          <td>${esc(u.fullName)}</td><td class="num">${esc(u.phoneNumber)}</td><td>${esc(u.pharmacyName)}</td><td>${esc(u.city)}</td><td>${esc(u.region)}</td>
          <td>
            ${u.isActive ? `<span class="badge ok">مفعّل</span>` : `<span class="badge rejected">موقوف</span>`}
            <button class="btn ${u.isActive?'danger':'approve'} sm sx-114" data-click="togglePharmacistActive" ${DA('click', String(u.id), (!u.isActive))}>${u.isActive?'إيقاف':'تفعيل'}</button>
          </td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>`}
  </div>`;
}

async function togglePharmacistActive(id, makeActive){
  try{
    await apiRequest('/users/pharmacists/' + id + '/active', { method:'PATCH', json:{ isActive: makeActive } });
    toast(makeActive ? 'تم تفعيل الحساب' : 'تم إيقاف الحساب');
    await loadPharmacists();
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

/* -------------------- تصدير Excel/PDF للعملاء المسجلين (حسب فلتر المنطقة الحالي فقط) -------------------- */
function statsFilteredList(){
  return (pharmacistsCache||[]).filter(u => statsFilter.city==='' || u.city===statsFilter.city);
}
function exportPharmacistsToExcel(){
  const list = statsFilteredList();
  if(list.length===0){ toast('لا يوجد عملاء لتصديرهم', 'danger'); return; }
  const data = list.map((u,i)=>({
    '#': i+1,
    'الاسم': u.fullName,
    'رقم الهاتف': u.phoneNumber,
    'اسم الصيدلية': u.pharmacyName,
    'المدينة': u.city || '',
    'المنطقة': u.region || '',
    'الحالة': u.isActive ? 'مفعّل' : 'موقوف',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:5},{wch:20},{wch:14},{wch:22},{wch:14},{wch:16},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'العملاء المسجلون');
  const label = statsFilter.city || 'كل-المناطق';
  XLSX.writeFile(wb, `العملاء-المسجلون-${label}-${toDateInputValue(new Date())}.xlsx`);
  toast('تم تصدير ملف Excel');
}
function printPharmacistsPDF(){
  const list = statsFilteredList();
  if(list.length===0){ toast('لا يوجد عملاء لتصديرهم', 'danger'); return; }
  const label = statsFilter.city || 'كل المناطق';
  const rowsHtml = list.map((u,i)=>`<tr>
    <td>${i+1}</td><td>${esc(u.fullName)}</td><td>${esc(u.phoneNumber)}</td><td>${esc(u.pharmacyName)}</td>
    <td>${esc(u.city||'')}</td><td>${esc(u.region||'')}</td><td>${u.isActive?'مفعّل':'موقوف'}</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>العملاء المسجلون - ${esc(label)}</title>
<link rel="stylesheet" href="${PRINT_CSS_URL}">
</head>
<body class="pdf-list">
  <div class="pdf-page">
    <div class="pdf-header">
      <div class="pdf-title">العملاء المسجلون</div>
      <div class="pdf-pharmacy">${esc(label)}</div>
      <div class="pdf-date">عدد العملاء: ${list.length} | تاريخ التصدير: ${fmtDate(new Date())}</div>
    </div>
    <table class="pdf-table">
      <thead><tr><th>#</th><th>الاسم</th><th>رقم الهاتف</th><th>الصيدلية</th><th>المدينة</th><th>المنطقة</th><th>الحالة</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
</body>
</html>`;

  const w = globalThis.open('', '_blank');
  if(!w){ toast('الرجاء السماح بالنوافذ المنبثقة (Popups) لهذا الموقع', 'danger'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  printWhenLoaded(w);
}

/* -------------------- تبويب: الدفعات الشهرية -------------------- */
function toLocalDateStr(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function tabPayouts(){
  const d = payoutsData;
  if(!d){
    return `<div class="section-title">الدفعات الشهرية</div><p class="sx-43">جارِ التحميل...</p>`;
  }
  const t = d.totals;
  const isLastMonth = d.scope === 'last_month';
  const lastMonthLabel = fmtMonth(shiftMonthKey(currentMonthKey(), -1));
  const emptyPayoutsTitle = isLastMonth ? ('لا توجد مستحقات لـ' + lastMonthLabel) : 'لا توجد مستحقات حاليًا';

  const warn = t.pendingInvoices > 0 ? `
  <div class="dup-warning sx-121">
    ⚠️ <b>تنبيه:</b> في <b>${t.pendingInvoices}</b> فاتورة لسا معلّقة (بانتظار مراجعتك) عند <b>${t.pharmacistsWithPending}</b> صيدلي.
    راجعها قبل التحويل. (دوس على "مراجعة الفواتير" جنب الصيدلي لتشوف فواتيره بالقسمين.)
  </div>` : '';

  return `
  <div class="admin-section-head">
    <div class="section-title sx-122">${isLastMonth ? ('دفعات ' + lastMonthLabel) : 'المستحق حاليًا'}</div>
    ${d.rows.length ? `<button class="export-btn" data-click="exportPayoutsToExcel">⬇ تصدير Excel</button>` : ''}
  </div>
  <p class="sx-123">
    ${isLastMonth
      ? `فواتير ${lastMonthLabel} فقط — من أول يوم الساعة 12:00 صباحًا لغاية آخر يوم 11:59 مساءً بتوقيت الأردن.`
      : 'كل العمولات المعتمدة وغير المحوّلة لحد هذه اللحظة، بدون أي قيد على تاريخ الفاتورة. التحويل متاح بأي وقت.'}
  </p>

  <div class="admin-section">
    <div class="sx-124">
      ${isLastMonth
        ? `<button class="btn ghost sm" data-click="setPayoutsScope" data-click-args="[&quot;live&quot;]">‹ رجوع للمستحق حاليًا</button>`
        : `<button class="btn ghost sm" data-click="setPayoutsScope" data-click-args="[&quot;last_month&quot;]">دفعات الشهر السابق</button>`}
    </div>

    ${warn}

    <div class="stat-grid">
      <div class="stat-card"><div class="v num">${fmtMoney(t.unpaidAmount)}</div><div class="l">المطلوب تحويله (د.أ)</div></div>
      <div class="stat-card"><div class="v num">${t.unpaidCount}</div><div class="l">صيدلي بانتظار التحويل</div></div>
    </div>

    ${d.rows.length===0 ? `<div class="empty-state"><div class="ic">💰</div><div class="t">${emptyPayoutsTitle}</div></div>` : `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>الصيدلاني / الصيدلية</th><th class="num">المبلغ (د.أ)</th><th>الاستلام</th><th>تنبيهات</th><th>الإجراء</th>
        </tr></thead>
        <tbody>
        ${d.rows.map(r=>renderPayoutRow(r)).join('')}
        </tbody>
      </table>
    </div>`}
  </div>`;
}

function renderPayoutRow(r){
  const alerts = [];
  if(r.pendingCount > 0){
    alerts.push(`<div class="dup-warning sx-125">⚠️ ${r.pendingCount} فاتورة معلّقة <button class="btn sm sx-126" data-click="reviewPharmacist" ${DA('click', String(r.pharmacistId))}>مراجعة الفواتير</button></div>`);
  }
  if(r.payoutInfoChangedRecently){
    alerts.push(`<div class="sx-127">🔔 تغيّرت بيانات الاستلام مؤخرًا — تأكد منها</div>`);
  }
  if(!r.isActive){
    alerts.push(`<div class="sx-128">الحساب موقوف</div>`);
  }

  const split = (r.medicineAmount>0 || r.cosmeticsAmount>0)
    ? `<div class="sx-129">أدوية ${fmtMoney(r.medicineAmount)} · كوزمتك ${fmtMoney(r.cosmeticsAmount)}</div>` : '';

  const action = r.amount > 0
    ? `<button class="btn approve sm" data-click="startConfirmPayout" ${DA('click', String(r.pharmacistId))}>✓ تأكيد التحويل</button>`
    : `<span class="sx-130">لا يوجد مبلغ جاهز</span>`;

  const row = `<tr>
    <td><b>${esc(r.fullName)}</b><div class="sx-131">${esc(r.pharmacyName)} · <span class="num">${esc(r.phoneNumber)}</span></div></td>
    <td class="num"><b>${fmtMoney(r.amount)}</b>${split}${r.salesCount ? `<div class="sx-129">${r.salesCount} عملية</div>` : ''}</td>
    <td>${r.payoutValue ? `${payoutTypeLabel(r.payoutType)}<div class="num sx-132">${esc(r.payoutValue)}</div>` : `<span class="sx-133">لم يدخل بيانات الاستلام</span>`}</td>
    <td>${alerts.join('') || '—'}</td>
    <td>${action}</td>
  </tr>`;

  if(confirmingPayoutId !== r.pharmacistId || r.amount<=0) return row;

  const noInfo = !r.payoutValue;
  return row + `<tr><td colspan="5" class="sx-134">
    <div class="sx-135">
      <div class="sx-99">تأكيد التحويل</div>
      <div>الصيدلاني: <b>${esc(r.fullName)}</b> — ${esc(r.pharmacyName)}</div>
      <div>المبلغ المطلوب تحويله: <b class="num sx-136">${fmtMoney(r.amount)} د.أ</b> (${r.salesCount} عملية)</div>
      <div>${payoutTypeLabel(r.payoutType)}: <b class="num">${esc(r.payoutValue || '—')}</b></div>
      ${r.pendingCount>0 ? `<div class="dup-warning sx-137">⚠️ عند هذا الصيدلي ${r.pendingCount} فاتورة معلّقة لسا ما انراجعت — القيمة هون ما بتشملها.</div>` : ''}
      ${noInfo ? `<div class="dup-warning sx-137">لا يمكن التأكيد: الصيدلي لم يدخل بيانات استلام المستحقات.</div>` : ''}
      <div class="field sx-137">
        <label>رقم عملية التحويل (اختياري)</label>
        <input type="text" id="payoutRef_${r.pharmacistId}" maxlength="100" placeholder="رقم العملية من تطبيق البنك">
      </div>
      <div class="sx-138">حوّل المبلغ من تطبيق البنك أولًا، وبعدها اضغط "نعم، تم التحويل" لتسجيله.</div>
      <div class="sx-139">
        <button class="btn approve sm" ${noInfo?'disabled':''} data-click="confirmPayout" ${DA('click', String(r.pharmacistId))}>نعم، تم التحويل</button>
        <button class="btn ghost sm" data-click="cancelConfirmPayout">إلغاء</button>
      </div>
    </div>
  </td></tr>`;
}

async function setPayoutsScope(scope){
  payoutsScope = scope;
  payoutsData = null; confirmingPayoutId = null;
  render();
  try{ await loadPayouts(); render(); }catch(e){ toast(e.message, 'danger'); }
}
function startConfirmPayout(id){ confirmingPayoutId = id; render(); }
function cancelConfirmPayout(){ confirmingPayoutId = null; render(); }

async function confirmPayout(pharmacistId){
  if(!payoutsData) return;
  const r = payoutsData.rows.find(x=>x.pharmacistId===pharmacistId);
  if(!r) return;
  const refEl = document.getElementById('payoutRef_'+pharmacistId);
  const reference = refEl ? refEl.value.trim() : '';
  try{
    await apiRequest('/payouts/confirm', { method:'POST', json:{
      pharmacistId,
      scope: payoutsScope,
      expectedAmount: Number(r.amount),
      expectedSalesCount: r.salesCount,
      ...(reference ? { reference } : {})
    }});
    toast('تم تسجيل الدفعة بنجاح ✓');
    confirmingPayoutId = null;
    await loadPayouts();
    render();
  }catch(e){
    toast(e.message, 'danger');
    if(e.code === 'AMOUNT_CHANGED'){
      confirmingPayoutId = null;
      try{ await loadPayouts(); render(); }catch(_e){ /* فشل تحديث القائمة — رسالة الخطأ الأصلية انعرضت فوق */ }
    }
  }
}

function exportPayoutsToExcel(){
  if(!payoutsData || payoutsData.rows.length===0){ toast('لا توجد بيانات لتصديرها', 'danger'); return; }
  const data = payoutsData.rows.map(r=>({
    'اسم الصيدلاني': r.fullName,
    'رقم الهاتف': r.phoneNumber,
    'اسم الصيدلية': r.pharmacyName,
    'المبلغ (دينار)': Number(Number(r.amount).toFixed(3)),
    'أدوية': Number(Number(r.medicineAmount).toFixed(3)),
    'كوزمتك': Number(Number(r.cosmeticsAmount).toFixed(3)),
    'عدد العمليات': r.salesCount,
    'نوع الاستلام': payoutTypeLabel(r.payoutType),
    'الاسم المستعار / رقم الهاتف': r.payoutValue || '',
    'فواتير معلّقة': r.pendingCount,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:20},{wch:14},{wch:22},{wch:14},{wch:12},{wch:12},{wch:12},{wch:14},{wch:24},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الدفعات');
  const label = payoutsScope==='last_month' ? 'الشهر-السابق' : 'الآن';
  XLSX.writeFile(wb, `مستحقات-${label}.xlsx`);
  toast('تم تصدير ملف Excel');
}

/* -------------------- تبويب: الدفعات الشهرية السابقة (سجل التحويلات) -------------------- */
function payoutsHistorySectionHtml(d){
  if(!d) return `<p class="sx-43">جارِ التحميل...</p>`;
  if(d.items.length===0) return `
  <div class="empty-state"><div class="ic">📜</div><div class="t">لا يوجد سجل مطابق</div></div>`;
  return `
  <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>الصيدلاني / الصيدلية</th><th>المنطقة</th><th class="num">المبلغ (د.أ)</th><th>التاريخ</th><th>رقم العملية</th><th>حوّله</th></tr></thead>
      <tbody>
      ${d.items.map(p=>`<tr>
        <td><b>${esc(p.pharmacist.fullName)}</b><div class="sx-131">${esc(p.pharmacist.pharmacyName)} · <span class="num">${esc(p.pharmacist.phoneNumber)}</span></div></td>
        <td>${esc(p.pharmacist.city)}</td>
        <td class="num"><b>${fmtMoney(p.amount)}</b><div class="sx-97">${p.salesCount} عملية</div></td>
        <td>${fmtDate(p.paidAt)}</td>
        <td class="num">${p.reference ? esc(p.reference) : '—'}</td>
        <td>${esc(p.paidBy.fullName)}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="sx-140">${d.items.length} من ${d.pagination.total}</div>
  `;
}

function tabPayoutsHistory(){
  const d = payoutsHistoryData;
  return `
  <div class="section-title">الدفعات الشهرية السابقة</div>
  <p class="sx-73">سجل كل التحويلات اللي صارت فعليًا لكل الصيادلة.</p>

  <div class="admin-section sx-57">
    <div class="row2 sx-52">
      <div class="field sx-74"><label>المنطقة / المدينة</label><input type="text" id="payoutsHistCity" placeholder="مثال: عمّان" value="${esc(payoutsHistoryFilter.city)}"></div>
      <div class="field sx-74"><label>اسم الصيدلية</label><input type="text" id="payoutsHistSearch" placeholder="ابحث بالاسم" value="${esc(payoutsHistoryFilter.search)}"></div>
    </div>
    <div class="sx-139">
      <button class="btn sm" data-click="applyPayoutsHistoryFilter">بحث</button>
      ${payoutsHistoryFilterActive ? `<button class="btn ghost sm" data-click="clearPayoutsHistoryFilter">إلغاء الفلتر</button>` : ''}
    </div>
  </div>

  ${payoutsHistorySectionHtml(d)}
  `;
}

async function applyPayoutsHistoryFilter(){
  payoutsHistoryFilter = {
    city: document.getElementById('payoutsHistCity').value.trim(),
    search: document.getElementById('payoutsHistSearch').value.trim(),
  };
  payoutsHistoryFilterActive = !!(payoutsHistoryFilter.city || payoutsHistoryFilter.search);
  payoutsHistoryData = null;
  render();
  try{ await loadPayoutsHistory(); render(); }catch(e){ toast(e.message, 'danger'); }
}
async function clearPayoutsHistoryFilter(){
  payoutsHistoryFilter = { city:'', search:'' };
  payoutsHistoryFilterActive = false;
  payoutsHistoryData = null;
  render();
  try{ await loadPayoutsHistory(); render(); }catch(e){ toast(e.message, 'danger'); }
}

/* -------------------- تبويب: مستحقات الإحالة (تأكيد التحويل + سجل تاريخي) -------------------- */
function referralDueRowHtml(r){
      const hasPayoutInfo = !!(r.payoutType && r.payoutValue);
  return `<tr>
          <td><b>${esc(r.fullName)}</b><div class="sx-131">${esc(r.pharmacyName)} · <span class="num">${esc(r.phoneNumber)}</span></div></td>
          <td class="num">${r.rewardsCount}</td>
          <td class="num"><b>${fmtMoney(r.totalAmount)}</b></td>
          <td>${hasPayoutInfo ? `${payoutTypeLabel(r.payoutType)} · <span class="num">${esc(r.payoutValue)}</span>` : `<span class="sx-141">لم يُدخل بعد</span>`}</td>
          <td>${hasPayoutInfo ? `<button class="btn sm" data-click="startConfirmReferral" ${DA('click', String(r.pharmacistId))}>تأكيد التحويل</button>` : '—'}</td>
        </tr>`;
}
function referralConfirmRowHtml(r){
  if(confirmingReferralId !== r.pharmacistId) return '';
  return `<tr><td colspan="5" class="sx-94">
          <div class="sx-52">رح تؤكد تحويل <b>${fmtMoney(r.totalAmount)} د.أ</b> (${r.rewardsCount} مكافأة) لـ <b>${esc(r.fullName)}</b> عبر ${payoutTypeLabel(r.payoutType)} - <span class="num">${esc(r.payoutValue)}</span>.</div>
          <div class="field sx-142"><label>رقم عملية التحويل (اختياري)</label><input type="text" id="referralRefInput" placeholder="مثال: CLIQ-12345"></div>
          <div class="sx-139">
            <button class="btn approve sm" data-click="confirmReferralTransferUI" ${DA('click', String(r.pharmacistId), (r.totalAmount), (r.rewardsCount))}>نعم، تم التحويل فعليًا</button>
            <button class="btn ghost sm" data-click="cancelConfirmReferral">إلغاء</button>
          </div>
        </td></tr>`;
}
function referralDueTableHtml(rows, totalDue){
  return `
  <div class="stat-grid sx-57">
    <div class="stat-card"><div class="v">${rows.length}</div><div class="l">صيدلي مستحق</div></div>
    <div class="stat-card"><div class="v">${fmtMoney(totalDue)}</div><div class="l">إجمالي المستحق (د.أ)</div></div>
  </div>
  <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>الصيدلاني / الصيدلية</th><th class="num">عدد الإحالات المفعّلة</th><th class="num">المبلغ المستحق (د.أ)</th><th>طريقة الاستلام</th><th></th></tr></thead>
      <tbody>
      ${rows.map(r => referralDueRowHtml(r) + referralConfirmRowHtml(r)).join('')}
      </tbody>
    </table>
  </div>`;
}
function referralHistorySectionHtml(){
  if(!referralHistoryData) return `<p class="sx-43">جارِ التحميل...</p>`;
  if(referralHistoryData.items.length===0) return `
  <div class="empty-state"><div class="ic">📜</div><div class="t">لا يوجد سجل بعد</div></div>`;
  return `
  <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>الصيدلاني / الصيدلية</th><th class="num">المبلغ (د.أ)</th><th class="num">عدد المكافآت</th><th>التاريخ</th><th>رقم العملية</th><th>حوّله</th></tr></thead>
      <tbody>
      ${referralHistoryData.items.map(p=>`<tr>
        <td><b>${esc(p.pharmacist.fullName)}</b><div class="sx-131">${esc(p.pharmacist.pharmacyName)}</div></td>
        <td class="num"><b>${fmtMoney(p.amount)}</b></td>
        <td class="num">${p.rewardsCount}</td>
        <td>${fmtDate(p.paidAt)}</td>
        <td class="num">${p.reference ? esc(p.reference) : '—'}</td>
        <td>${esc(p.paidBy.fullName)}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="sx-140">${referralHistoryData.items.length} من ${referralHistoryData.pagination.total}</div>
  `;
}

function tabReferralAdmin(){
  const rows = referralAdminData || [];
  const totalDue = rows.reduce((sum,r)=>sum+r.totalAmount, 0);

  return `
  <div class="section-title">مستحقات الإحالة</div>
  <p class="sx-73">مكافآت الإحالة (دينار عن كل صيدلي محال فعّل حسابه) المستحقة حاليًا لكل صيدلي، مجمّعة حسب مين أحال. التأكيد يتحقق من المبلغ الحالي الفعلي وقت الضغط، فلو انضافت مكافأة جديدة أثناء انتظارك بيرفض ويطلب تحديث الصفحة.</p>

  ${rows.length===0 ? `<div class="empty-state"><div class="ic">🤝</div><div class="t">لا يوجد مستحقات إحالة حاليًا</div></div>` : referralDueTableHtml(rows, totalDue)}

  <div class="section-title sx-143">سجل تحويلات الإحالة السابقة</div>
  ${referralHistorySectionHtml()}
  `;
}

function startConfirmReferral(id){ confirmingReferralId = id; render(); }
function cancelConfirmReferral(){ confirmingReferralId = null; render(); }

async function confirmReferralTransferUI(pharmacistId, expectedAmount, expectedRewardsCount){
  const refEl = document.getElementById('referralRefInput');
  const reference = refEl ? refEl.value.trim() : '';
  try{
    await apiRequest('/referral/admin/transfer', { method:'POST', json:{
      pharmacistId, expectedAmount, expectedRewardsCount, reference: reference || undefined,
    }});
    toast('تم تسجيل تحويل مستحقات الإحالة بنجاح');
    confirmingReferralId = null;
    referralAdminData = null; referralHistoryData = null;
    render();
    await Promise.all([loadReferralAdmin(), loadReferralHistory()]);
    render();
  }catch(e){
    // AMOUNT_CHANGED: تغيّر المبلغ الفعلي منذ فتح الصفحة (مكافأة جديدة انضافت مثلًا) — نحدّث البيانات
    // ونخلي الأدمن يشوف الرقم الجديد ويأكد عليه من جديد، بدل ما نمرر رقم قديم غلط
    if(e.code === 'AMOUNT_CHANGED'){
      toast(e.message, 'danger');
      confirmingReferralId = null;
      referralAdminData = null;
      render();
      try{ await loadReferralAdmin(); render(); }catch(_e){ /* فشل تحديث القائمة — رسالة الخطأ الأصلية انعرضت فوق */ }
    } else {
      toast(e.message, 'danger');
    }
  }
}

/* -------------------- تبويب: التقارير -------------------- */
function tabReports(){
  return `
  <div class="section-title">تقارير العمولات</div>
  <div class="admin-section">
    <div class="section-title">العمولات المؤكدة حسب المنطقة والمدى الزمني</div>
    ${pharmacistComboField('admin', {label:'اسم الصيدلية'})}
    <div class="field">
      <label>المنطقة</label>
      <select id="filterCity">
        <option value="" ${adminFilter.city===''?'selected':''}>كل المناطق</option>
        ${JORDAN_CITIES.map(c=>`<option value="${c}" ${adminFilter.city===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="row2">
      <div class="field">
        <label>من تاريخ</label>
        <input type="date" id="filterFromDate" value="${adminFilter.fromDate}">
      </div>
      <div class="field">
        <label>إلى تاريخ</label>
        <input type="date" id="filterToDate" value="${adminFilter.toDate}">
      </div>
    </div>
    <button class="btn" data-click="runRegionFilter">عرض التقرير</button>

    ${adminFilterActive ? renderRegionFilterResults() : ''}
  </div>
  `;
}

/* -------------------- صندوق بحث/اختيار صيدلية (Combo) — يُستخدم بتقارير العمولات وتقارير التعويض -------------------- */
// ns = 'admin' (تقارير العمولات) أو 'ASIL'/'ZAROZA' (تقارير التعويض) — كل واحد إله حالة فلتر مستقلة
function pharmacistFilterState(ns){
  return ns==='admin' ? adminFilter : compReportsFilter[ns];
}
function pharmacistComboField(ns, opts){
  const f = pharmacistFilterState(ns);
  const label = opts?.label || 'الصيدلية';
  return `
  <div class="field">
    <label>${esc(label)}</label>
    <div class="combo-wrap">
      <input type="text" id="filterPharmacistSearch_${ns}" placeholder="اكتب اسم الصيدلية أو اضغط لعرض الكل"
        value="${esc(f.pharmacistName||'')}" autocomplete="off"
        data-input="filterPharmacistCombo" ${DA('input', String(ns))} data-focus="openPharmacistCombo" ${DA('focus', String(ns))}
        data-blur="closePharmacistComboDelayed" ${DA('blur', String(ns))}>
      ${f.pharmacistId ? `<button type="button" class="combo-clear" data-click="clearPharmacistCombo" ${DA('click', String(ns))}>✕</button>` : ''}
      <div class="combo-list hidden" id="filterPharmacistList_${ns}">${renderPharmacistComboOptions(ns, '')}</div>
    </div>
  </div>`;
}
// خيارات قائمة البحث عن صيدلية — تُبنى مباشرة بدون render() كامل حتى ما ينفلت فوكس صندوق الكتابة
function renderPharmacistComboOptions(ns, query){
  const f = pharmacistFilterState(ns);
  const q = (query||'').trim();
  const list = (pharmacistsCache||[]).slice().sort((a,b)=> (a.pharmacyName||'').localeCompare(b.pharmacyName||'', 'ar'));
  const filtered = q ? list.filter(p => (p.pharmacyName||'').includes(q) || (p.fullName||'').includes(q)) : list;
  const allOpt = `<div class="combo-opt ${!f.pharmacistId?'active':''}" data-click="pickPharmacistCombo" ${DA('click', String(ns), '', '')}>كل الصيدليات</div>`;
  if(pharmacistsCache===null){
    return allOpt + `<div class="combo-empty">جارِ تحميل الصيدليات...</div>`;
  }
  if(filtered.length===0){
    return allOpt + `<div class="combo-empty">لا توجد صيدلية بهاد الاسم</div>`;
  }
  return allOpt + filtered.map(p=>`
    <div class="combo-opt ${f.pharmacistId===p.id?'active':''}" data-click="pickPharmacistCombo" ${DA('click', String(ns), String(p.id))}>
      <span>${esc(p.pharmacyName)}</span><span class="combo-sub">${esc(p.city||'')}</span>
    </div>`).join('');
}
function openPharmacistCombo(ns){
  const listEl = document.getElementById('filterPharmacistList_'+ns);
  if(listEl) listEl.classList.remove('hidden');
}
function closePharmacistCombo(ns){
  const listEl = document.getElementById('filterPharmacistList_'+ns);
  if(listEl) listEl.classList.add('hidden');
}
function filterPharmacistCombo(ns){
  const input = document.getElementById('filterPharmacistSearch_'+ns);
  const listEl = document.getElementById('filterPharmacistList_'+ns);
  if(!input || !listEl) return;
  listEl.innerHTML = renderPharmacistComboOptions(ns, input.value);
  listEl.classList.remove('hidden');
}
function pickPharmacistCombo(ns, id){
  const f = pharmacistFilterState(ns);
  // الاسم بيُقرأ من الكاش بالـ id (ما بنمرّره داخل onclick أبدًا: الاقتباسات المهرّبة بـ esc() بترجع لأصلها
  // قبل ما يشتغل الـ JS، وهاد كان يسمح بتنفيذ كود من اسم صيدلية خبيث)
  const p = id ? (pharmacistsCache||[]).find(x => x.id === id) : null;
  f.pharmacistId = p ? p.id : '';
  f.pharmacistName = p ? p.pharmacyName : '';
  render();
}
function clearPharmacistCombo(ns){
  const f = pharmacistFilterState(ns);
  f.pharmacistId = '';
  f.pharmacistName = '';
  render();
}

async function runRegionFilter(){
  adminFilter.city = document.getElementById('filterCity').value;
  adminFilter.fromDate = document.getElementById('filterFromDate').value;
  adminFilter.toDate = document.getElementById('filterToDate').value;
  const dep = currentDepartmentParam();
  const depQs = dep ? ('&department='+dep) : '';
  try{
    const [salesRes, pharmRes] = await Promise.all([
      apiRequest('/sales?status=APPROVED&saleType=NORMAL&pageSize=500' + depQs),
      apiRequest('/users/pharmacists')
    ]);
    const cityById = {};
    for(const p of pharmRes.data){ cityById[p.id] = p.city; }
    const fromD = adminFilter.fromDate, toD = adminFilter.toDate;
    reportsRows = salesRes.data.items.filter(s=>{
      const saleDay = toDateInputValue(s.saleDate);
      if(saleDay < fromD || saleDay > toD) return false;
      const city = cityById[s.pharmacistId];
      if(adminFilter.city !== '' && city !== adminFilter.city) return false;
      if(adminFilter.pharmacistId !== '' && s.pharmacistId !== adminFilter.pharmacistId) return false;
      return true;
    }).map(s=> ({...s, _city: cityById[s.pharmacistId] || ''}))
      .sort((a,b)=> a.saleDate===b.saleDate ? new Date(a.createdAt)-new Date(b.createdAt) : String(a.saleDate).localeCompare(String(b.saleDate)));
    adminFilterActive = true;
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

function renderRegionFilterResults(){
  const approvedResults = reportsRows;
  const total = approvedResults.reduce((a,s)=>a+Number(s.commissionAmount),0);
  const distinctPharmacies = new Set(approvedResults.map(s=>s.pharmacistId)).size;
  const label = adminFilter.pharmacistName || adminFilter.city || 'كل المناطق';

  return `
  <div class="sx-119">
    <div class="stat-grid">
      <div class="stat-card"><div class="v num">${approvedResults.length}</div><div class="l">عمولة مؤكدة</div></div>
      <div class="stat-card"><div class="v num">${distinctPharmacies}</div><div class="l">صيدلية فعّالة</div></div>
      <div class="stat-card"><div class="v num">${fmtMoney(total)}</div><div class="l">إجمالي العمولات (د.أ)</div></div>
    </div>
    ${approvedResults.length===0 ? `<div class="empty-state"><div class="ic">🔎</div><div class="t">لا توجد عمولات مؤكدة</div><div class="d">في ${esc(label)} بين ${fmtDate(adminFilter.fromDate)} و${fmtDate(adminFilter.toDate)}</div></div>` : `
    <div class="sx-120">
      <button class="export-btn" data-click="exportReportsToExcel">⬇ تصدير Excel</button>
      <button class="export-btn" data-click="printReportsPDF">🖨️ تصدير PDF</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>#</th><th>الصيدلية</th><th>المنطقة</th><th>الصنف</th><th class="num">القطع</th><th class="num">العمولة (د.أ)</th><th>التاريخ</th><th>الحالة</th><th>الفاتورة</th></tr></thead>
        <tbody>
        ${approvedResults.map((s,i)=>{
          const p = s.pharmacist;
          return `<tr><td class="num">${i+1}</td><td>${esc(p?p.pharmacyName:'')}</td><td>${esc(s._city)}</td><td>${saleItemLabel(s)}</td><td class="num">${s.quantity}</td><td class="num">${fmtMoney(s.commissionAmount)}</td><td>${fmtDate(s.saleDate)}</td><td>${statusBadgeHtml(s)}</td><td>${invoiceViewButtonHtml(s)}</td></tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`}
  </div>`;
}

function saleItemLabelPlain(s){
  const type = s.saleType || 'NORMAL';
  if(type === 'ASIL' || type === 'ZAROZA'){
    const mainName = s.compensationItem ? s.compensationItem.name : '—';
    const freeName = s.freeCompensationItem ? s.freeCompensationItem.name : '—';
    return `${mainName} (فري: ${freeName})`;
  }
  return s.category ? s.category.name : '';
}

/* -------------------- تبويبات: تقارير تعويض الأصيل / زاروزا -------------------- */
function compReportTitle(type){ return type==='ASIL' ? 'تعويض الأصيل' : 'تعويض زاروزا'; }

function tabCompReports(type){
  const f = compReportsFilter[type];
  return `
  <div class="section-title">تقارير ${compReportTitle(type)}</div>
  <div class="admin-section">
    <div class="section-title">فواتير ${compReportTitle(type)} حسب المنطقة/الصيدلية والمدى الزمني</div>
    <div class="field">
      <label>المنطقة</label>
      <select id="compFilterCity_${type}">
        <option value="" ${f.city===''?'selected':''}>كل المناطق</option>
        ${JORDAN_CITIES.map(c=>`<option value="${c}" ${f.city===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    ${pharmacistComboField(type, {label:'الصيدلية'})}
    <div class="row2">
      <div class="field">
        <label>من تاريخ</label>
        <input type="date" id="compFilterFromDate_${type}" value="${f.fromDate}">
      </div>
      <div class="field">
        <label>إلى تاريخ</label>
        <input type="date" id="compFilterToDate_${type}" value="${f.toDate}">
      </div>
    </div>
    <button class="btn" data-click="runCompReportFilter" ${DA('click', String(type))}>عرض التقرير</button>

    ${compReportsActive[type] ? renderCompReportResults(type) : ''}
  </div>
  `;
}

async function runCompReportFilter(type){
  const f = compReportsFilter[type];
  f.city = document.getElementById('compFilterCity_'+type).value;
  f.fromDate = document.getElementById('compFilterFromDate_'+type).value;
  f.toDate = document.getElementById('compFilterToDate_'+type).value;
  try{
    const [salesRes, pharmRes] = await Promise.all([
      apiRequest('/sales?status=APPROVED&saleType=' + type + '&department=COSMETICS&pageSize=500'),
      pharmacistsCache ? Promise.resolve({data:pharmacistsCache}) : apiRequest('/users/pharmacists')
    ]);
    pharmacistsCache = pharmRes.data;
    const cityById = {};
    for(const p of pharmacistsCache){ cityById[p.id] = p.city; }
    const fromD = f.fromDate, toD = f.toDate;
    compReportsRows[type] = salesRes.data.items.filter(s=>{
      const saleDay = toDateInputValue(s.saleDate);
      if(saleDay < fromD || saleDay > toD) return false;
      const city = cityById[s.pharmacistId];
      if(f.city !== '' && city !== f.city) return false;
      if(f.pharmacistId !== '' && s.pharmacistId !== f.pharmacistId) return false;
      return true;
    }).map(s=> ({...s, _city: cityById[s.pharmacistId] || ''}))
      .sort((a,b)=> a.saleDate===b.saleDate ? new Date(a.createdAt)-new Date(b.createdAt) : String(a.saleDate).localeCompare(String(b.saleDate)));
    compReportsActive[type] = true;
    render();
  }catch(e){ toast(e.message, 'danger'); }
}

function renderCompReportResults(type){
  const rows = compReportsRows[type] || [];
  const f = compReportsFilter[type];
  const distinctPharmacies = new Set(rows.map(s=>s.pharmacistId)).size;
  const label = f.pharmacistName || f.city || 'كل المناطق';

  return `
  <div class="sx-119">
    <div class="stat-grid">
      <div class="stat-card"><div class="v num">${rows.length}</div><div class="l">فاتورة تعويض مؤكدة</div></div>
      <div class="stat-card"><div class="v num">${distinctPharmacies}</div><div class="l">صيدلية فعّالة</div></div>
    </div>
    ${rows.length===0 ? `<div class="empty-state"><div class="ic">🔎</div><div class="t">لا توجد فواتير مؤكدة</div><div class="d">في ${esc(label)} بين ${fmtDate(f.fromDate)} و${fmtDate(f.toDate)}</div></div>` : `
    <div class="sx-120">
      <button class="export-btn" data-click="exportCompDetailedExcel" ${DA('click', String(type))}>⬇ تصدير تفصيلي Excel</button>
      <button class="export-btn" data-click="printCompFreeItemsPDF" ${DA('click', String(type))}>🖨️ تصدير PDF لكل صيدلية</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>#</th><th>الصيدلية</th><th>المنطقة</th><th>الصنف الأساسي</th><th>الصنف الفري</th><th>التاريخ</th><th>الحالة</th><th>الفاتورة</th></tr></thead>
        <tbody>
        ${rows.map((s,i)=>{
          const p = s.pharmacist;
          return `<tr><td class="num">${i+1}</td><td>${esc(p?p.pharmacyName:'')}</td><td>${esc(s._city)}</td><td>${s.compensationItem?esc(s.compensationItem.name):''}</td><td>${s.freeCompensationItem?esc(s.freeCompensationItem.name):''}</td><td>${fmtDate(s.saleDate)}</td><td>${statusBadgeHtml(s)}</td><td>${invoiceViewButtonHtml(s)}</td></tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`}
  </div>`;
}

function exportCompDetailedExcel(type){
  const rows = compReportsRows[type] || [];
  if(rows.length===0){ toast('لا توجد فواتير لتصديرها', 'danger'); return; }
  const data = rows.map((s,i)=>{
    const p = s.pharmacist;
    return {
      '#': i+1,
      'اسم الصيدلية': p ? p.pharmacyName : '',
      'صاحب الحساب': p ? p.fullName : '',
      'رقم الهاتف': p ? p.phoneNumber : '',
      'المنطقة': s._city,
      'الصنف الأساسي': s.compensationItem ? s.compensationItem.name : '',
      'الصنف الفري': s.freeCompensationItem ? s.freeCompensationItem.name : '',
      'تاريخ البيع': toDateInputValue(s.saleDate),
      'الحالة': 'مقبولة'
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:5},{wch:22},{wch:18},{wch:14},{wch:16},{wch:22},{wch:22},{wch:14},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, compReportTitle(type));
  XLSX.writeFile(wb, `تفصيلي-${compReportTitle(type)}-${toDateInputValue(new Date())}.xlsx`);
  toast('تم تصدير الملف التفصيلي');
}

function computeFreeItemsByPharmacy(rows){
  const byPharm = {};
  for(const s of rows){
    if(!s.freeCompensationItem) continue;
    const pid = s.pharmacistId;
    const pname = s.pharmacist ? s.pharmacist.pharmacyName : 'غير معروف';
    if(!byPharm[pid]) { byPharm[pid] = { pharmacyName: pname, items: {}, total: 0 }; }
    const iname = s.freeCompensationItem.name;
    byPharm[pid].items[iname] = (byPharm[pid].items[iname]||0) + 1;
    byPharm[pid].total += 1;
  }
  return Object.values(byPharm)
    .map(p=>({
      pharmacyName: p.pharmacyName,
      total: p.total,
      items: Object.entries(p.items).map(([name,count])=>({name,count})).sort((a,b)=>a.name.localeCompare(b.name,'ar'))
    }))
    .sort((a,b)=> a.pharmacyName.localeCompare(b.pharmacyName,'ar'));
}

function printCompFreeItemsPDF(type){
  const rows = compReportsRows[type] || [];
  if(rows.length===0){ toast('لا توجد فواتير لتصديرها', 'danger'); return; }
  const byPharmacy = computeFreeItemsByPharmacy(rows);
  if(byPharmacy.length===0){ toast('لا توجد قطع فري لتصديرها', 'danger'); return; }

  const dateLabel = fmtDate(new Date());
  const pagesHtml = byPharmacy.map(p=>`
    <div class="pdf-page">
      <div class="pdf-header">
        <div class="pdf-title">${compReportTitle(type)} — القطع الواجب تعويضها</div>
        <div class="pdf-pharmacy">${esc(p.pharmacyName)}</div>
        <div class="pdf-date">تاريخ التصدير: ${dateLabel}</div>
      </div>
      <table class="pdf-table">
        <thead><tr><th>#</th><th>الصنف (القطعة الفري)</th><th>عدد القطع المستحقة</th></tr></thead>
        <tbody>
          ${p.items.map((it,i)=>`<tr><td>${i+1}</td><td>${esc(it.name)}</td><td>${it.count}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="2">الإجمالي</td><td>${p.total}</td></tr></tfoot>
      </table>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>القطع الواجب تعويضها - ${compReportTitle(type)}</title>
<link rel="stylesheet" href="${PRINT_CSS_URL}">
</head>
<body class="pdf-comp">
${pagesHtml}
</body>
</html>`;

  const w = globalThis.open('', '_blank');
  if(!w){ toast('الرجاء السماح بالنوافذ المنبثقة (Popups) لهذا الموقع', 'danger'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  printWhenLoaded(w);
}

/* -------------------- تصدير Excel/PDF لتقرير عمولات البيع (حسب الفلتر الحالي فقط) -------------------- */
function exportReportsToExcel(){
  const rows = reportsRows || [];
  if(rows.length===0){ toast('لا توجد نتائج لتصديرها', 'danger'); return; }
  const data = rows.map((s,i)=>{
    const p = s.pharmacist;
    return {
      '#': i+1,
      'اسم الصيدلية': p ? p.pharmacyName : '',
      'صاحب الحساب': p ? p.fullName : '',
      'رقم الهاتف': p ? p.phoneNumber : '',
      'المنطقة': s._city || '',
      'الصنف': saleItemLabelPlain(s),
      'عدد القطع': s.quantity,
      'قيمة العمولة (دينار)': Number(Number(s.commissionAmount).toFixed(3)),
      'تاريخ البيع': toDateInputValue(s.saleDate),
      'الحالة': 'مقبولة'
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:5},{wch:22},{wch:18},{wch:14},{wch:14},{wch:26},{wch:10},{wch:18},{wch:14},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'عمولات البيع');
  const label = adminFilter.pharmacistName || adminFilter.city || 'الكل';
  XLSX.writeFile(wb, `عمولات-البيع-${label}-${toDateInputValue(new Date())}.xlsx`);
  toast('تم تصدير ملف Excel');
}

function printReportsPDF(){
  const rows = reportsRows || [];
  if(rows.length===0){ toast('لا توجد نتائج لتصديرها', 'danger'); return; }
  const label = adminFilter.pharmacistName || adminFilter.city || 'كل المناطق';
  const total = rows.reduce((a,s)=>a+Number(s.commissionAmount),0);
  const rowsHtml = rows.map((s,i)=>{
    const p = s.pharmacist;
    return `<tr><td>${i+1}</td><td>${esc(p?p.pharmacyName:'')}</td><td>${esc(s._city||'')}</td><td>${esc(saleItemLabelPlain(s))}</td><td>${s.quantity}</td><td>${fmtMoney(s.commissionAmount)}</td><td>${fmtDate(s.saleDate)}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير عمولات البيع - ${esc(label)}</title>
<link rel="stylesheet" href="${PRINT_CSS_URL}">
</head>
<body class="pdf-sales">
  <div class="pdf-page">
    <div class="pdf-header">
      <div class="pdf-title">تقرير عمولات البيع</div>
      <div class="pdf-pharmacy">${esc(label)}</div>
      <div class="pdf-date">الفترة: ${fmtDate(adminFilter.fromDate)} — ${fmtDate(adminFilter.toDate)} | تاريخ التصدير: ${fmtDate(new Date())}</div>
    </div>
    <table class="pdf-table">
      <thead><tr><th>#</th><th>الصيدلية</th><th>المنطقة</th><th>الصنف</th><th>القطع</th><th>العمولة (د.أ)</th><th>التاريخ</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td colspan="5">الإجمالي</td><td>${fmtMoney(total)}</td><td></td></tr></tfoot>
    </table>
  </div>
</body>
</html>`;

  const w = globalThis.open('', '_blank');
  if(!w){ toast('الرجاء السماح بالنوافذ المنبثقة (Popups) لهذا الموقع', 'danger'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  printWhenLoaded(w);
}


/* ---------------- دوال مركّبة (كانت أكتر من جملة داخل onclick) ---------------- */
function resetRegThenGoto(page){ resetReg(); goto(page); }
function resetForgotThenGoto(page){ resetForgot(); goto(page); }
function resetAdmin2faThenLogin(){ admin2fa = {challengeToken:null,maskedPhone:'',devCode:null}; goto('login'); }
function clickElementById(id){ document.getElementById(id).click(); }
function setMessagesDraftName(value){ messagesDraft.name = value; }
function closePharmacistComboDelayed(ns){ setTimeout(function(){ closePharmacistCombo(ns); }, 150); }

/* ---------------- ربط الأحداث (بدل onclick / onchange / oninput / onfocus / onblur الـ inline) ----------------
   كل عنصر بيحمل data-click="اسم_الإجراء" (أو change/input/focus/blur) مع data-<حدث>-args (JSON) اختياريًا.
   الإجراءات المسموحة محصورة بهالقائمة فقط. */
const ACTIONS = {
  ackPayoutIntro,
  addCategory,
  addCompensationItem,
  applyPayoutsHistoryFilter,
  approveSale,
  cancelConfirmPayout,
  cancelConfirmReferral,
  cancelEditCategory,
  cancelMessageSend,
  cancelPayoutEdit,
  cancelReject,
  chooseAdminPanel,
  chooseDepartment,
  chooseSaleMode,
  clearMessagePharmacists,
  clearPayoutsHistoryFilter,
  clearPharmacistCombo,
  clearPharmacistFilter,
  clickElementById,
  closeCompareImageModal,
  closeImageModal,
  closePharmacistComboDelayed,
  confirmMessageSend,
  confirmPayout,
  confirmReferralTransferUI,
  confirmRejectSale,
  copyReferralText,
  createAccount,
  deleteCategory,
  deleteCompensationItem,
  doLogin,
  doLogout,
  exportCompDetailedExcel,
  exportPayoutsToExcel,
  exportPharmacistsToExcel,
  exportReportsToExcel,
  filterPharmacistCombo,
  finalizeSale,
  forgotReset,
  forgotSendOtp,
  forgotVerifyOtp,
  goStep2,
  goToHistoryAfterSale,
  goto,
  handleInvoiceFile,
  onMessagePharmacistSearch,
  onMessageTextInput,
  onPayoutTypeChange,
  onPayoutValueInput,
  openCompareImageModal,
  openImageModal,
  openPharmacistCombo,
  pickCategory,
  pickFreeItem,
  pickHistoryStatus,
  pickHistoryType,
  pickMainItem,
  pickPharmacistCombo,
  printCompFreeItemsPDF,
  printPharmacistsPDF,
  printReportsPDF,
  reactivateCategory,
  reactivateCompensationItem,
  requestMessageApproval,
  resetAdmin2faThenLogin,
  resetForgotThenGoto,
  resetRegThenGoto,
  reviewPharmacist,
  runCompReportFilter,
  runRegionFilter,
  runStatsFilter,
  saveDate,
  saveEditCategory,
  saveInvoiceAndFinish,
  savePayoutInfo,
  saveQty,
  sendOtp,
  setMessagesDraftName,
  setPayoutsScope,
  startConfirmPayout,
  startConfirmReferral,
  startEditCategory,
  startForgotFromReg,
  startMessageSend,
  startPayoutEdit,
  startReject,
  submitAdminPasswordChange,
  switchAdminPanel,
  switchCatMgmtSubTab,
  switchDepartment,
  switchSaleMode,
  switchTab,
  toggleDateEdit,
  toggleFreeItemsSummary,
  toggleMessageAllPharmacists,
  toggleMessageCampaignDetail,
  toggleMessageCity,
  toggleMessagePharmacist,
  togglePharmacistActive,
  verifyAdmin2fa,
  verifyOtp,
  verifyPayoutEditOtp
};
function DA(ev, ...args){
  return 'data-' + ev + '-args="' + esc(JSON.stringify(args)) + '"';
}
const DELEGATED_EVENTS = { click:'click', change:'change', input:'input', focusin:'focus', focusout:'blur' };
function readDelegatedCalls(attr, e){
  const calls = [];
  for(const node of e.composedPath()){
    if(!(node instanceof Element) || !node.hasAttribute(attr)) continue;
    const rawArgs = node.getAttribute(attr + '-args');
    calls.push({
      el: node,
      name: node.getAttribute(attr),
      args: rawArgs ? JSON.parse(rawArgs) : [],
      pass: node.getAttribute(attr + '-pass')
    });
  }
  return calls;
}
function runDelegatedCall(call){
  if(!Object.hasOwn(ACTIONS, call.name)) return;
  const args = [...call.args];
  if(call.pass === 'this') args.push(call.el);
  if(call.pass === 'value') args.push(call.el.value);
  ACTIONS[call.name](...args);
}
for(const [domEvent, key] of Object.entries(DELEGATED_EVENTS)){
  document.addEventListener(domEvent, e => {
    for(const call of readDelegatedCalls('data-' + key, e)) runDelegatedCall(call);
  });
}

/* نوافذ الطباعة بترث الـ CSP: ملف التنسيق خارجي وبنشغّل الطباعة من هون بدل onload الـ inline */
const PRINT_CSS_URL = new URL('css/print.css', globalThis.location.href).href;
function printWhenLoaded(w){
  w.addEventListener('load', () => w.print());
}

/* ---------------- init ---------------- */
function bootstrapApp(){
  // new URLSearchParams(string) و params.get() ما بيرموا استثناء، فما في داعي لـ try/catch هون
  const params = new URLSearchParams(globalThis.location.search);
  const ref = params.get('ref');
  if(ref && /^[A-Za-z0-9]{4,12}$/.test(ref.trim())) incomingReferralCode = ref.trim().toUpperCase();

  document.getElementById('app').innerHTML = `<div class="center-wrap"><div class="sx-43">جارِ التحميل...</div></div>`;
  // ما في طريقة لجافاسكربت يعرف مسبقًا إذا في كوكي جلسة صالحة (httpOnly) — فبنحاول
  // /users/me دايمًا، والسيرفر هو اللي بيقرر (401 لو ما في جلسة، ونعتبره تسجيل دخول عادي).
  // ملاحظة: top-level await غير ممكن هون لأنه بيحتاج type="module" على وسم السكربت، وهاد بيخلي كل الدوال
  // خاصة بالموديول فبتتعطل معالجات onclick/onchange الـ inline — لهيك بنستخدم سلسلة Promise داخل الدالة.
  loadMe()
    .then(()=>{
      clearAllCaches();
      if(currentUser.type === 'admin'){
        adminPanelChosen = false; adminDeptFilter = '';
        activeTab = 'admin';
      } else {
        activeTab = 'add';
      }
      render();
    })
    .catch(()=>{
      // فحص الجلسة فشل (ما في كوكي صالحة أو السيرفر مش متاح): نكمل كزائر وبنعرض شاشة الدخول
      currentUser = null;
      render();
    });
}
bootstrapApp();
