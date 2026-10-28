// Application Logic for SHDT Quiz Master

// --- Global State ---
let currentMode = 'study';
let currentIndex = 0;
let filteredQuestions = [];
let selectedTopic = 'all';

// Local storage persistent data
let userStudyAnswers = JSON.parse(localStorage.getItem('shdt_study_answers') || '{}');
let bookmarks = new Set(JSON.parse(localStorage.getItem('shdt_bookmarks') || '[]'));
let mistakeHistory = new Set(JSON.parse(localStorage.getItem('shdt_mistakes') || '[]'));
let isSoundEnabled = localStorage.getItem('shdt_sound') !== 'false';
let isAutoNext = localStorage.getItem('shdt_auto_next') === 'true';

// Exam State
let examState = {
  questions: [],
  answers: {},
  flags: new Set(),
  currentIndex: 0,
  timeRemaining: 0,
  totalTime: 0,
  timerInterval: null,
  isSubmitted: false,
  results: null
};

// Review State
let currentReviewTab = 'bookmark'; // 'bookmark' or 'mistake'

// --- Web Audio Synthesizer (No external sound files required) ---
const audioCtx = (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined')
  ? new (window.AudioContext || window.webkitAudioContext)()
  : null;

function playSound(type) {
  if (!isSoundEnabled || !audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'correct') {
      // Pleasant high double chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'wrong') {
      // Low subtle tone
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.setValueAtTime(180, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    }
  } catch (e) {
    console.error("Audio error", e);
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTopicFilter();
  initSoundToggle();
  initAutoNextToggle();
  updateBookmarkBadges();
  
  // Set initial filtered list
  applyTopicFilter();
  renderCurrentQuestion();
  updateStudyStats();
  renderDrawerGrid();
  renderSearchList();

  // Setup Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);
});

// --- Theme Management ---
function initTheme() {
  const isDark = localStorage.getItem('shdt_theme') === 'dark' || 
    (!localStorage.getItem('shdt_theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.getElementById('theme-btn').innerText = '☀️';
  } else {
    document.documentElement.classList.remove('dark');
    document.getElementById('theme-btn').innerText = '🌙';
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('shdt_theme', isDark ? 'dark' : 'light');
  document.getElementById('theme-btn').innerText = isDark ? '☀️' : '🌙';
  playSound('click');
}

// --- Sound Toggle ---
function initSoundToggle() {
  document.getElementById('sound-btn').innerText = isSoundEnabled ? '🔊' : '🔇';
}

function toggleSound() {
  isSoundEnabled = !isSoundEnabled;
  localStorage.setItem('shdt_sound', isSoundEnabled);
  document.getElementById('sound-btn').innerText = isSoundEnabled ? '🔊' : '🔇';
  if (isSoundEnabled) playSound('click');
}

// --- Auto-next Toggle ---
function initAutoNextToggle() {
  const toggle = document.getElementById('auto-next-toggle');
  if (toggle) {
    toggle.checked = isAutoNext;
    toggle.addEventListener('change', (e) => {
      isAutoNext = e.target.checked;
      localStorage.setItem('shdt_auto_next', isAutoNext);
    });
  }
}

// --- Navigation & Mode Switching ---
function switchMode(mode) {
  currentMode = mode;
  playSound('click');

  // Hide all views
  document.querySelectorAll('.view-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(el => {
    el.classList.remove('bg-white', 'dark:bg-slate-700', 'text-blue-600', 'dark:text-blue-400', 'shadow-sm');
    el.classList.add('text-slate-600', 'dark:text-slate-300');
  });

  // Activate selected view
  const targetView = document.getElementById(`view-${mode}`);
  if (targetView) targetView.classList.remove('hidden');

  const targetNav = document.getElementById(`nav-${mode}`);
  if (targetNav) {
    targetNav.classList.add('bg-white', 'dark:bg-slate-700', 'text-blue-600', 'dark:text-blue-400', 'shadow-sm');
    targetNav.classList.remove('text-slate-600', 'dark:text-slate-300');
  }

  // Update mobile tabs
  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.classList.remove('text-blue-600', 'dark:text-blue-400', 'font-semibold');
    btn.classList.add('text-slate-600', 'dark:text-slate-300');
  });

  if (mode === 'study') {
    renderCurrentQuestion();
    updateStudyStats();
  } else if (mode === 'review') {
    renderReviewView();
  } else if (mode === 'search') {
    renderSearchList();
  }
}

// --- Topic Filter Management ---
function initTopicFilter() {
  const select = document.getElementById('study-topic-filter');
  if (!select) return;

  const topics = Array.from(new Set(window.QUIZ_DATA.map(q => q.topic)));
  topics.forEach(topic => {
    const count = window.QUIZ_DATA.filter(q => q.topic === topic).length;
    const opt = document.createElement('option');
    opt.value = topic;
    opt.innerText = `${topic} (${count} câu)`;
    select.appendChild(opt);
  });
}

function onTopicFilterChange() {
  const select = document.getElementById('study-topic-filter');
  selectedTopic = select.value;
  applyTopicFilter();
  currentIndex = 0;
  renderCurrentQuestion();
  renderDrawerGrid();
  playSound('click');
}

function applyTopicFilter() {
  if (selectedTopic === 'all') {
    filteredQuestions = [...window.QUIZ_DATA];
  } else {
    filteredQuestions = window.QUIZ_DATA.filter(q => q.topic === selectedTopic);
  }
}

// --- Render Study Question ---
function renderCurrentQuestion() {
  if (filteredQuestions.length === 0) return;
  const q = filteredQuestions[currentIndex];
  if (!q) return;

  // Metadata
  document.getElementById('q-index').innerText = currentIndex + 1;
  document.getElementById('q-total').innerText = filteredQuestions.length;
  document.getElementById('q-topic').innerText = q.topic;
  document.getElementById('q-prompt').innerText = q.prompt;

  // Bookmark icon status
  updateBookmarkButton(q.id);

  // Options
  const container = document.getElementById('options-container');
  container.innerHTML = '';

  const userAnswer = userStudyAnswers[q.id];
  const isAnswered = !!userAnswer;

  ['A', 'B', 'C', 'D'].forEach(letter => {
    const text = q.options[letter];
    if (!text) return;

    const btn = document.createElement('button');
    btn.className = `option-btn w-full text-left p-4 rounded-2xl border flex items-start gap-3.5 transition-all outline-none `;
    
    // Check styling depending on whether answered or not
    if (!isAnswered) {
      btn.className += `bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 text-slate-800 dark:text-slate-200 cursor-pointer shadow-sm`;
      btn.onclick = () => selectStudyOption(letter);
    } else {
      btn.disabled = true;
      if (letter === q.correct) {
        // Correct Answer
        btn.className += `bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-semibold shadow-sm`;
      } else if (letter === userAnswer && userAnswer !== q.correct) {
        // User picked wrong
        btn.className += `bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-900 dark:text-rose-200 line-through opacity-90`;
      } else {
        // Neutral other options
        btn.className += `bg-slate-50/60 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 opacity-60`;
      }
    }

    // Badge letter
    let badgeClass = "w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ";
    if (!isAnswered) {
      badgeClass += "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
    } else if (letter === q.correct) {
      badgeClass += "bg-emerald-600 text-white shadow-sm";
    } else if (letter === userAnswer && userAnswer !== q.correct) {
      badgeClass += "bg-rose-600 text-white shadow-sm";
    } else {
      badgeClass += "bg-slate-100 dark:bg-slate-800 text-slate-400";
    }

    btn.innerHTML = `
      <span class="${badgeClass}">${letter}</span>
      <span class="flex-1 text-sm sm:text-base leading-snug pt-0.5">${text}</span>
      ${isAnswered && letter === q.correct ? '<span class="text-emerald-600 text-lg">✓</span>' : ''}
      ${isAnswered && letter === userAnswer && userAnswer !== q.correct ? '<span class="text-rose-600 text-lg">✗</span>' : ''}
    `;

    container.appendChild(btn);
  });

  // Explanation Box
  const expBox = document.getElementById('explanation-box');
  if (isAnswered) {
    expBox.classList.remove('hidden');
    document.getElementById('explanation-correct-tag').innerText = `Đáp án đúng: ${q.correct}`;
    document.getElementById('explanation-text').innerText = q.explanation;
  } else {
    expBox.classList.add('hidden');
  }

  // Update Drawer selection
  updateDrawerActiveState();
}

// --- Option Selection in Study Mode ---
function selectStudyOption(letter) {
  const q = filteredQuestions[currentIndex];
  if (!q) return;

  const isCorrect = (letter === q.correct);
  userStudyAnswers[q.id] = letter;
  localStorage.setItem('shdt_study_answers', JSON.stringify(userStudyAnswers));

  if (!isCorrect) {
    mistakeHistory.add(q.id);
    localStorage.setItem('shdt_mistakes', JSON.stringify(Array.from(mistakeHistory)));
    playSound('wrong');
  } else {
    playSound('correct');
  }

  renderCurrentQuestion();
  updateStudyStats();
  renderDrawerGrid();

  // Auto next if enabled and correct
  if (isCorrect && isAutoNext) {
    setTimeout(() => {
      if (currentIndex < filteredQuestions.length - 1) {
        nextQuestion();
      }
    }, 700);
  }
}

function resetCurrentQuestion() {
  const q = filteredQuestions[currentIndex];
  if (!q) return;
  delete userStudyAnswers[q.id];
  localStorage.setItem('shdt_study_answers', JSON.stringify(userStudyAnswers));
  renderCurrentQuestion();
  updateStudyStats();
  renderDrawerGrid();
  playSound('click');
}

function prevQuestion() {
  if (currentIndex > 0) {
    currentIndex--;
    renderCurrentQuestion();
    playSound('click');
  }
}

function nextQuestion() {
  if (currentIndex < filteredQuestions.length - 1) {
    currentIndex++;
    renderCurrentQuestion();
    playSound('click');
  }
}

function jumpRandomQuestion() {
  currentIndex = Math.floor(Math.random() * filteredQuestions.length);
  renderCurrentQuestion();
  playSound('click');
}

// --- Bookmarking (Star) ---
function toggleBookmarkCurrent() {
  const q = filteredQuestions[currentIndex];
  if (!q) return;

  if (bookmarks.has(q.id)) {
    bookmarks.delete(q.id);
  } else {
    bookmarks.add(q.id);
  }
  localStorage.setItem('shdt_bookmarks', JSON.stringify(Array.from(bookmarks)));
  updateBookmarkButton(q.id);
  updateBookmarkBadges();
  renderDrawerGrid();
  playSound('click');
}

function updateBookmarkButton(qid) {
  const btn = document.getElementById('q-bookmark-btn');
  if (!btn) return;
  const isBookmarked = bookmarks.has(qid);
  if (isBookmarked) {
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 fill-amber-500 text-amber-500" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>`;
    btn.classList.add('text-amber-500');
  } else {
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>`;
    btn.classList.remove('text-amber-500');
  }
}

function updateBookmarkBadges() {
  const count = bookmarks.size;
  const countEl = document.getElementById('bookmark-badge');
  const countMob = document.getElementById('mobile-bookmark-badge');
  if (countEl) countEl.innerText = count;
  if (countMob) countMob.innerText = count;
}

// --- Study Statistics ---
function updateStudyStats() {
  let correct = 0;
  let wrong = 0;
  let answered = 0;

  filteredQuestions.forEach(q => {
    const ans = userStudyAnswers[q.id];
    if (ans) {
      answered++;
      if (ans === q.correct) correct++;
      else wrong++;
    }
  });

  const cEl = document.getElementById('stat-correct');
  const wEl = document.getElementById('stat-wrong');
  const pEl = document.getElementById('stat-progress');

  if (cEl) cEl.innerText = correct;
  if (wEl) wEl.innerText = wrong;
  if (pEl) pEl.innerText = `${answered}/${filteredQuestions.length}`;
}

// --- Question Drawer Matrix ---
function toggleQuestionDrawer() {
  const drawer = document.getElementById('question-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!drawer || !backdrop) return;

  const isClosed = drawer.classList.contains('translate-x-full');
  if (isClosed) {
    renderDrawerGrid();
    drawer.classList.remove('translate-x-full');
    backdrop.classList.remove('hidden');
  } else {
    drawer.classList.add('translate-x-full');
    backdrop.classList.add('hidden');
  }
  playSound('click');
}

function renderDrawerGrid() {
  const grid = document.getElementById('drawer-grid');
  if (!grid) return;
  grid.innerHTML = '';

  filteredQuestions.forEach((q, idx) => {
    const btn = document.createElement('button');
    const ans = userStudyAnswers[q.id];
    const isBookmarked = bookmarks.has(q.id);

    let statusClass = "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700";
    if (ans) {
      if (ans === q.correct) {
        statusClass = "bg-emerald-500 text-white border-emerald-600";
      } else {
        statusClass = "bg-rose-500 text-white border-rose-600";
      }
    }

    if (idx === currentIndex) {
      statusClass += " ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-900 font-black";
    }

    btn.className = `p-2 rounded-xl text-xs font-semibold border flex flex-col items-center justify-center relative hover:scale-105 transition-all ${statusClass}`;
    btn.innerHTML = `
      <span>${idx + 1}</span>
      ${isBookmarked ? '<span class="absolute -top-1 -right-1 text-[10px]">⭐</span>' : ''}
    `;

    btn.onclick = () => {
      currentIndex = idx;
      renderCurrentQuestion();
      toggleQuestionDrawer();
    };

    grid.appendChild(btn);
  });
}

function updateDrawerActiveState() {
  // Highlights active item in drawer
  const grid = document.getElementById('drawer-grid');
  if (!grid) return;
  const items = grid.querySelectorAll('button');
  items.forEach((btn, idx) => {
    if (idx === currentIndex) {
      btn.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'dark:ring-offset-slate-900', 'font-black');
    } else {
      btn.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2', 'dark:ring-offset-slate-900', 'font-black');
    }
  });
}

function resetAllStudyProgress() {
  if (confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử luyện tập để làm lại từ đầu?")) {
    userStudyAnswers = {};
    localStorage.removeItem('shdt_study_answers');
    renderCurrentQuestion();
    updateStudyStats();
    renderDrawerGrid();
    playSound('click');
  }
}

// ==================== EXAM MODE LOGIC ====================
function startExam() {
  const countSelect = document.getElementById('exam-count-select');
  const timeSelect = document.getElementById('exam-time-select');

  const count = parseInt(countSelect.value);
  const minutes = parseInt(timeSelect.value);

  // Shuffle and pick questions
  const shuffled = [...window.QUIZ_DATA].sort(() => 0.5 - Math.random());
  examState.questions = shuffled.slice(0, count);
  examState.answers = {};
  examState.flags = new Set();
  examState.currentIndex = 0;
  examState.totalTime = minutes * 60;
  examState.timeRemaining = minutes * 60;
  examState.isSubmitted = false;
  examState.results = null;

  // UI switch
  document.getElementById('exam-setup-box').classList.add('hidden');
  document.getElementById('exam-result-box').classList.add('hidden');
  document.getElementById('exam-active-box').classList.remove('hidden');

  // Start timer
  if (examState.timerInterval) clearInterval(examState.timerInterval);
  if (minutes > 0) {
    document.getElementById('exam-timer-wrapper').classList.remove('hidden');
    updateExamTimerDisplay();
    examState.timerInterval = setInterval(() => {
      examState.timeRemaining--;
      updateExamTimerDisplay();
      if (examState.timeRemaining <= 0) {
        clearInterval(examState.timerInterval);
        submitExam(true);
      }
    }, 1000);
  } else {
    document.getElementById('exam-timer-wrapper').classList.add('hidden');
  }

  renderExamQuestion();
  renderExamGrid();
  playSound('click');
}

function updateExamTimerDisplay() {
  const m = Math.floor(examState.timeRemaining / 60);
  const s = examState.timeRemaining % 60;
  const str = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const el = document.getElementById('exam-timer');
  if (el) {
    el.innerText = str;
    if (examState.timeRemaining <= 180) { // < 3 mins warning
      el.classList.add('text-rose-600', 'animate-pulse');
    } else {
      el.classList.remove('text-rose-600', 'animate-pulse');
    }
  }
}

function renderExamQuestion() {
  const q = examState.questions[examState.currentIndex];
  if (!q) return;

  document.getElementById('exam-q-num').innerText = examState.currentIndex + 1;
  document.getElementById('exam-q-total').innerText = examState.questions.length;
  document.getElementById('exam-topic-badge').innerText = q.topic;
  document.getElementById('exam-prompt').innerText = q.prompt;

  // Answered count update
  document.getElementById('exam-answered-count').innerText = Object.keys(examState.answers).length;

  // Flag button state
  const flagBtn = document.getElementById('btn-exam-flag');
  if (examState.flags.has(examState.currentIndex)) {
    flagBtn.className = "px-3 py-1.5 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-xs sm:text-sm font-semibold transition-colors";
    flagBtn.innerText = "🚩 Đã đặt cờ";
  } else {
    flagBtn.className = "px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs sm:text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors";
    flagBtn.innerText = "🚩 Đặt cờ";
  }

  // Render options
  const container = document.getElementById('exam-options');
  container.innerHTML = '';

  const currentAnswer = examState.answers[examState.currentIndex];

  ['A', 'B', 'C', 'D'].forEach(letter => {
    const text = q.options[letter];
    if (!text) return;

    const isSelected = (currentAnswer === letter);
    const btn = document.createElement('button');
    btn.className = `option-btn w-full text-left p-4 rounded-2xl border flex items-start gap-3.5 transition-all outline-none cursor-pointer `;
    
    if (isSelected) {
      btn.className += `bg-blue-50 dark:bg-blue-950/50 border-blue-600 text-blue-900 dark:text-blue-100 font-semibold shadow-sm`;
    } else {
      btn.className += `bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-slate-400 text-slate-800 dark:text-slate-200`;
    }

    btn.innerHTML = `
      <span class="w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600'}">${letter}</span>
      <span class="flex-1 text-sm sm:text-base leading-snug pt-0.5">${text}</span>
    `;

    btn.onclick = () => selectExamOption(letter);
    container.appendChild(btn);
  });

  renderExamGrid();
}

function selectExamOption(letter) {
  examState.answers[examState.currentIndex] = letter;
  renderExamQuestion();
  playSound('click');
}

function clearExamCurrentChoice() {
  delete examState.answers[examState.currentIndex];
  renderExamQuestion();
  playSound('click');
}

function toggleExamFlag() {
  if (examState.flags.has(examState.currentIndex)) {
    examState.flags.delete(examState.currentIndex);
  } else {
    examState.flags.add(examState.currentIndex);
  }
  renderExamQuestion();
  playSound('click');
}

function prevExamQuestion() {
  if (examState.currentIndex > 0) {
    examState.currentIndex--;
    renderExamQuestion();
  }
}

function nextExamQuestion() {
  if (examState.currentIndex < examState.questions.length - 1) {
    examState.currentIndex++;
    renderExamQuestion();
  }
}

function renderExamGrid() {
  const grid = document.getElementById('exam-grid');
  if (!grid) return;
  grid.innerHTML = '';

  examState.questions.forEach((q, idx) => {
    const isAnswered = (examState.answers[idx] !== undefined);
    const isFlagged = examState.flags.has(idx);
    const isCurrent = (idx === examState.currentIndex);

    let cls = "p-2 rounded-xl text-xs font-semibold border flex flex-col items-center justify-center relative transition-all ";
    
    if (isCurrent) {
      cls += "bg-blue-600 text-white border-blue-600 ring-2 ring-blue-400 font-bold ";
    } else if (isAnswered) {
      cls += "bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600 ";
    } else {
      cls += "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-400 ";
    }

    if (isFlagged) {
      cls += "border-amber-400 ";
    }

    const btn = document.createElement('button');
    btn.className = cls;
    btn.innerHTML = `
      <span>${idx + 1}</span>
      ${isFlagged ? '<span class="absolute -top-1 -right-1 text-[9px]">🚩</span>' : ''}
    `;

    btn.onclick = () => {
      examState.currentIndex = idx;
      renderExamQuestion();
    };

    grid.appendChild(btn);
  });
}

function confirmSubmitExam() {
  const answeredCount = Object.keys(examState.answers).length;
  const total = examState.questions.length;
  const unanswered = total - answeredCount;

  let msg = `Bạn đã trả lời ${answeredCount}/${total} câu hỏi.`;
  if (unanswered > 0) {
    msg += ` Còn ${unanswered} câu chưa trả lời. Bạn có chắc chắn muốn nộp bài?`;
  } else {
    msg += ` Bạn có chắc chắn muốn nộp bài?`;
  }

  if (confirm(msg)) {
    submitExam(false);
  }
}

function submitExam(isAutoTimeout = false) {
  if (examState.timerInterval) clearInterval(examState.timerInterval);
  examState.isSubmitted = true;

  // Calculate results
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;

  const total = examState.questions.length;
  examState.questions.forEach((q, idx) => {
    const userAns = examState.answers[idx];
    if (!userAns) {
      unanswered++;
    } else if (userAns === q.correct) {
      correct++;
    } else {
      wrong++;
      mistakeHistory.add(q.id);
    }
  });

  localStorage.setItem('shdt_mistakes', JSON.stringify(Array.from(mistakeHistory)));

  const score10 = ((correct / total) * 10).toFixed(1);
  const accuracy = Math.round((correct / total) * 100);

  // Time taken
  const timeUsedSeconds = examState.totalTime > 0 ? (examState.totalTime - examState.timeRemaining) : 0;
  const timeUsedMin = Math.floor(timeUsedSeconds / 60);
  const timeUsedSec = timeUsedSeconds % 60;

  examState.results = {
    total,
    correct,
    wrong,
    unanswered,
    score10,
    accuracy,
    timeUsed: `${timeUsedMin} phút ${timeUsedSec} giây`
  };

  // UI updates
  document.getElementById('exam-active-box').classList.add('hidden');
  document.getElementById('exam-result-box').classList.remove('hidden');

  document.getElementById('res-score-number').innerText = score10;
  document.getElementById('res-correct-count').innerText = correct;
  document.getElementById('res-wrong-count').innerText = wrong;
  document.getElementById('res-unanswered-count').innerText = unanswered;
  document.getElementById('res-accuracy').innerText = `${accuracy}%`;
  document.getElementById('res-time-summary').innerText = `Thời gian làm bài: ${examState.results.timeUsed}${isAutoTimeout ? ' (Hết giờ tự động nộp)' : ''}`;

  const gradeTitle = document.getElementById('res-grade-title');
  if (score10 >= 9.0) {
    gradeTitle.innerText = "Xuất Sắc! 🏆";
  } else if (score10 >= 8.0) {
    gradeTitle.innerText = "Giỏi! 🎉";
  } else if (score10 >= 6.5) {
    gradeTitle.innerText = "Khá! 👏";
  } else if (score10 >= 5.0) {
    gradeTitle.innerText = "Trung Bình - Cần Cố Gắng! 📚";
  } else {
    gradeTitle.innerText = "Cần Ôn Tập Lại Kiến Thức! ⚠️";
  }

  playSound(score10 >= 7 ? 'correct' : 'wrong');
}

function resetExamToSetup() {
  document.getElementById('exam-result-box').classList.add('hidden');
  document.getElementById('exam-review-section').classList.add('hidden');
  document.getElementById('exam-setup-box').classList.remove('hidden');
  playSound('click');
}

function reviewExamAnswers() {
  const revSec = document.getElementById('exam-review-section');
  revSec.classList.remove('hidden');
  filterExamReviewQuestions();
  revSec.scrollIntoView({ behavior: 'smooth' });
}

function filterExamReviewQuestions() {
  const filter = document.getElementById('exam-review-filter').value;
  const list = document.getElementById('exam-review-list');
  list.innerHTML = '';

  examState.questions.forEach((q, idx) => {
    const userAns = examState.answers[idx];
    const isCorrect = (userAns === q.correct);
    const isUnanswered = !userAns;

    if (filter === 'wrong' && isCorrect) return;
    if (filter === 'correct' && !isCorrect) return;

    let badgeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    let badgeText = "ĐÚNG";
    if (isUnanswered) {
      badgeClass = "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
      badgeText = "CHƯA TRẢ LỜI";
    } else if (!isCorrect) {
      badgeClass = "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
      badgeText = "SAI";
    }

    const card = document.createElement('div');
    card.className = "p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col gap-3 shadow-sm";
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-slate-500">Câu ${idx + 1} (${q.topic})</span>
        <span class="text-xs font-black px-2.5 py-0.5 rounded-full ${badgeClass}">${badgeText}</span>
      </div>
      <div class="font-bold text-slate-900 dark:text-white text-sm sm:text-base">${q.prompt}</div>
      <div class="grid grid-cols-1 gap-2 pt-1">
        ${['A', 'B', 'C', 'D'].map(letter => {
          let optCls = "p-3 rounded-xl border text-xs sm:text-sm flex items-start gap-2 ";
          if (letter === q.correct) {
            optCls += "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-semibold";
          } else if (letter === userAns) {
            optCls += "border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200";
          } else {
            optCls += "border-slate-100 dark:border-slate-800 text-slate-500 opacity-70";
          }
          return `
            <div class="${optCls}">
              <span class="font-bold">${letter}.</span>
              <span>${q.options[letter]}</span>
              ${letter === q.correct ? '<span class="ml-auto text-emerald-600 font-bold">✓ Đáp án đúng</span>' : ''}
              ${letter === userAns && !isCorrect ? '<span class="ml-auto text-rose-600 font-bold">✗ Bạn chọn</span>' : ''}
            </div>
          `;
        }).join('')}
      </div>
      <div class="p-3.5 rounded-xl bg-blue-50/70 dark:bg-slate-800 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
        <strong class="text-blue-700 dark:text-blue-400">💡 Lời giải:</strong> ${q.explanation}
      </div>
    `;

    list.appendChild(card);
  });
}

// ==================== REVIEW / BOOKMARKS VIEW ====================
function setReviewTab(tab) {
  currentReviewTab = tab;
  const starBtn = document.getElementById('tab-review-star');
  const wrongBtn = document.getElementById('tab-review-wrong');

  if (tab === 'bookmark') {
    starBtn.className = "px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800";
    wrongBtn.className = "px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300";
  } else {
    wrongBtn.className = "px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800";
    starBtn.className = "px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300";
  }

  renderReviewView();
  playSound('click');
}

function renderReviewView() {
  document.getElementById('count-star').innerText = bookmarks.size;
  document.getElementById('count-wrong').innerText = mistakeHistory.size;

  const list = document.getElementById('review-list');
  list.innerHTML = '';

  const targetIds = currentReviewTab === 'bookmark' ? Array.from(bookmarks) : Array.from(mistakeHistory);

  if (targetIds.length === 0) {
    list.innerHTML = `
      <div class="text-center py-12 text-slate-400 dark:text-slate-500">
        <div class="text-4xl mb-3">${currentReviewTab === 'bookmark' ? '⭐' : '🎉'}</div>
        <p class="font-medium">${currentReviewTab === 'bookmark' ? 'Chưa có câu hỏi nào được gắn sao.' : 'Tuyệt vời! Bạn chưa có câu nào làm sai hoặc chưa bắt đầu làm bài.'}</p>
        <p class="text-xs mt-1">Trong khi luyện tập, bạn có thể nhấn biểu tượng ngôi sao để lưu lại câu khó.</p>
      </div>
    `;
    return;
  }

  targetIds.forEach(qid => {
    const q = window.QUIZ_DATA.find(item => item.id === qid);
    if (!q) return;

    const card = document.createElement('div');
    card.className = "p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col gap-3";
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">Câu ${q.id}</span>
          <span class="text-xs text-slate-500">${q.topic}</span>
        </div>
        <button onclick="removeReviewItem(${q.id})" class="text-xs text-slate-400 hover:text-rose-500 transition-colors">
          Gỡ bỏ
        </button>
      </div>
      <div class="font-bold text-slate-900 dark:text-white text-sm sm:text-base">${q.prompt}</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm">
        ${['A', 'B', 'C', 'D'].map(l => `
          <div class="p-2.5 rounded-xl border ${l === q.correct ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-400 text-emerald-800 dark:text-emerald-200 font-semibold' : 'border-slate-200 dark:border-slate-700'}">
            <strong>${l}.</strong> ${q.options[l]}
          </div>
        `).join('')}
      </div>
      <div class="text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
        <strong class="text-blue-600 dark:text-blue-400">💡 Giải thích:</strong> ${q.explanation}
      </div>
    `;
    list.appendChild(card);
  });
}

function removeReviewItem(qid) {
  if (currentReviewTab === 'bookmark') {
    bookmarks.delete(qid);
    localStorage.setItem('shdt_bookmarks', JSON.stringify(Array.from(bookmarks)));
    updateBookmarkBadges();
  } else {
    mistakeHistory.delete(qid);
    localStorage.setItem('shdt_mistakes', JSON.stringify(Array.from(mistakeHistory)));
  }
  renderReviewView();
  playSound('click');
}

// ==================== SEARCH & BROWSE VIEW ====================
let isAllExpanded = false;

function onSearchInput(query) {
  renderSearchList(query);
}

function toggleExpandAllSearch() {
  isAllExpanded = !isAllExpanded;
  const list = document.getElementById('search-results-list');
  const details = list.querySelectorAll('details');
  details.forEach(d => d.open = isAllExpanded);
}

function renderSearchList(query = '') {
  const list = document.getElementById('search-results-list');
  if (!list) return;

  const cleanQuery = query.toLowerCase().trim();
  const matched = window.QUIZ_DATA.filter(q => {
    if (!cleanQuery) return true;
    const inPrompt = q.prompt.toLowerCase().includes(cleanQuery);
    const inTopic = q.topic.toLowerCase().includes(cleanQuery);
    const inOptions = Object.values(q.options).some(opt => opt.toLowerCase().includes(cleanQuery));
    const inExp = q.explanation.toLowerCase().includes(cleanQuery);
    return inPrompt || inTopic || inOptions || inExp;
  });

  document.getElementById('search-result-count').innerText = matched.length;
  list.innerHTML = '';

  matched.forEach(q => {
    const card = document.createElement('div');
    card.className = "p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm flex flex-col gap-2.5";
    
    card.innerHTML = `
      <div class="flex items-center justify-between text-xs">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded-md font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">Câu ${q.id}</span>
          <span class="text-slate-500 font-medium">${q.topic}</span>
        </div>
        <button onclick="jumpToStudyQuestion(${q.id})" class="text-blue-600 hover:underline font-semibold flex items-center gap-1">
          Luyện câu này →
        </button>
      </div>

      <div class="font-bold text-slate-900 dark:text-white text-sm sm:text-base leading-snug">
        ${highlightSearch(q.prompt, cleanQuery)}
      </div>

      <details class="group mt-1" ${isAllExpanded ? 'open' : ''}>
        <summary class="cursor-pointer text-xs font-semibold text-blue-600 dark:text-blue-400 select-none flex items-center gap-1">
          <span>Xem đáp án & giải thích</span>
        </summary>
        <div class="pt-3 flex flex-col gap-2">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
            ${['A', 'B', 'C', 'D'].map(l => `
              <div class="p-2 rounded-lg border ${l === q.correct ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-400 text-emerald-800 dark:text-emerald-200 font-bold' : 'border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400'}">
                ${l}. ${highlightSearch(q.options[l], cleanQuery)}
              </div>
            `).join('')}
          </div>
          <div class="text-xs bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl text-slate-600 dark:text-slate-300 border border-slate-100 dark:border-slate-700">
            <strong class="text-blue-600 dark:text-blue-400">💡 Giải thích:</strong> ${highlightSearch(q.explanation, cleanQuery)}
          </div>
        </div>
      </details>
    `;

    list.appendChild(card);
  });
}

function highlightSearch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<mark class="bg-amber-200 dark:bg-amber-800 text-inherit rounded px-0.5">$1</mark>');
}

function jumpToStudyQuestion(qid) {
  selectedTopic = 'all';
  const sel = document.getElementById('study-topic-filter');
  if (sel) sel.value = 'all';
  applyTopicFilter();
  
  const targetIdx = filteredQuestions.findIndex(q => q.id === qid);
  if (targetIdx !== -1) {
    currentIndex = targetIdx;
  }
  switchMode('study');
}

// --- Keyboard Shortcuts ---
function handleKeyboardShortcuts(e) {
  // Ignore inside inputs
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

  if (currentMode === 'study') {
    const key = e.key.toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(key)) {
      selectStudyOption(key);
    } else if (['1', '2', '3', '4'].includes(key)) {
      const map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
      selectStudyOption(map[key]);
    } else if (e.key === 'ArrowRight' || e.key === ' ') {
      nextQuestion();
    } else if (e.key === 'ArrowLeft') {
      prevQuestion();
    }
  } else if (currentMode === 'exam') {
    const key = e.key.toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(key)) {
      selectExamOption(key);
    } else if (e.key === 'ArrowRight') {
      nextExamQuestion();
    } else if (e.key === 'ArrowLeft') {
      prevExamQuestion();
    }
  }
}
