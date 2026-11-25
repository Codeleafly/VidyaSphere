/**
 * Teacher Studio Main Controller
 */

import { apiRequest } from '/js/api.js';
import { logout, setCurrentUser } from '/js/auth.js';
import {
  CLASS_LIST, SUBJECT_LIST, escapeHtml, initIcons, initM3Theme,
  renderThemePickerHtml, bindThemePicker, showToast
} from '/js/ui.js';
import { initLessonsModule, loadTeacherLessons, openLessonModal } from '/js/teacher/lessons.js';
import { initQuizzesAndHomework, loadTeacherQuizzes, loadTeacherHomework, openQuizModal } from '/js/teacher/quizzes.js';
import { initClassRoomModule, loadTeacherNotices, loadTeacherUnitTests, loadClassRoster } from '/js/teacher/classRoom.js';

initM3Theme();

let currentTeacher = null;

export function populateSelectOptions(selectEl, items, preferred = []) {
  if (!selectEl) return;
  const unique = [...new Set([...preferred, ...items].filter(Boolean))];
  selectEl.innerHTML = unique.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('');
}

export async function refreshOverview() {
  try {
    const res = await apiRequest('/teacher/overview');
    const o = res.overview || {};
    document.getElementById('t-stat-lessons').textContent = o.lessonsCount ?? 0;
    document.getElementById('t-stat-quizzes').textContent = o.quizzesCount ?? 0;
    document.getElementById('t-stat-homework').textContent = o.homeworkCount ?? 0;
    document.getElementById('t-stat-notes').textContent = o.notesCount ?? 0;

    const pill = document.getElementById('roster-pending-pill');
    if (pill && currentTeacher?.teacherType === 'class') {
      pill.textContent = o.pendingClassStudents ?? 0;
      pill.classList.toggle('hidden', (o.pendingClassStudents || 0) === 0);
    }
  } catch (err) {
    console.error('Overview load error:', err);
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.t-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.t-mob-tab').forEach(btn => {
    const pill = btn.querySelector('.t-pill');
    const label = btn.querySelector('span:last-child');
    const active = btn.dataset.tab === tabId;
    if (pill) {
      pill.className = active
        ? 't-pill px-3.5 py-1 rounded-full bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
        : 't-pill px-3.5 py-1 rounded-full text-[var(--md-on-surface-variant)]';
    }
    if (label) label.className = active ? 'font-bold' : 'font-medium';
  });

  document.querySelectorAll('.t-tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`)?.classList.remove('hidden');

  if (tabId === 'home') refreshOverview();
  if (tabId === 'lessons') loadTeacherLessons(currentTeacher);
  if (tabId === 'quizzes') {
    loadTeacherQuizzes(currentTeacher);
    loadTeacherHomework(currentTeacher);
  }
  if (tabId === 'notices') {
    loadTeacherNotices(currentTeacher);
    if (currentTeacher?.teacherType === 'class') loadTeacherUnitTests(currentTeacher);
  }
  if (tabId === 'roster' && currentTeacher?.teacherType === 'class') {
    loadClassRoster(currentTeacher);
  }
}

async function verifyTeacherSession() {
  try {
    const res = await apiRequest('/auth/me');
    const u = res.user;
    if (!u) {
      window.location.replace('/auth/login.html');
      return null;
    }
    setCurrentUser(u);
    if (u.accountStatus === 'pending') {
      window.location.replace('/auth/pending.html');
      return null;
    }
    if (u.role !== 'teacher' && u.role !== 'admin') {
      window.location.replace('/dashboard/index.html');
      return null;
    }
    return u;
  } catch {
    window.location.replace('/auth/login.html');
    return null;
  }
}

function hydrateTeacherProfileUI(user) {
  const isClassTeacher = user.teacherType === 'class';
  const typeLabel = user.role === 'admin'
    ? 'Admin Faculty Preview'
    : (isClassTeacher ? `Class Teacher • ${user.className}${user.division ? ' (' + user.division + ')' : ''}` : 'Subject Teacher');

  document.getElementById('teacher-display-name').textContent = user.fullName || user.username;
  document.getElementById('teacher-display-type').textContent = typeLabel;
  document.getElementById('teacher-mob-badge').textContent = typeLabel;
  document.getElementById('home-role-pill').textContent = typeLabel;
  document.getElementById('home-greeting').textContent = `Welcome, ${user.fullName || user.username}`;

  const chipsEl = document.getElementById('home-assignments-chips');
  const classes = user.assignedClasses || [];
  const subjects = user.assignedSubjects || [];
  chipsEl.innerHTML = [
    ...classes.map(c => `<span class="px-2.5 py-0.5 rounded-full bg-white text-[11px] font-bold border border-[var(--md-outline)]">${escapeHtml(c)}</span>`),
    ...subjects.map(s => `<span class="px-2.5 py-0.5 rounded-full bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] text-[11px] font-bold">${escapeHtml(s)}</span>`),
  ].join('');

  const dmSwitch = document.getElementById('dm-privacy-switch');
  if (dmSwitch) dmSwitch.checked = user.allowStudentDms !== false;

  if (isClassTeacher) {
    document.getElementById('nav-roster-desktop')?.classList.remove('hidden');
    document.getElementById('nav-roster-mob')?.classList.remove('hidden');
    document.getElementById('class-teacher-tests-panel')?.classList.remove('hidden');
  }

  // Populate dropdowns prioritizing teacher's assigned classes & subjects
  populateSelectOptions(document.getElementById('les-class'), CLASS_LIST, classes);
  populateSelectOptions(document.getElementById('les-subject'), SUBJECT_LIST, subjects);
  populateSelectOptions(document.getElementById('tn-class'), CLASS_LIST, classes);
  populateSelectOptions(document.getElementById('tn-subject'), SUBJECT_LIST, subjects);
  populateSelectOptions(document.getElementById('qz-class'), CLASS_LIST, classes);
  populateSelectOptions(document.getElementById('qz-subject'), SUBJECT_LIST, subjects);
  populateSelectOptions(document.getElementById('hw-class'), CLASS_LIST, classes);
  populateSelectOptions(document.getElementById('hw-subject'), SUBJECT_LIST, subjects);

  const scopedClasses = [...new Set([...(isClassTeacher && user.className ? [user.className] : []), ...classes])];
  populateSelectOptions(
    document.getElementById('t-ann-class'),
    user.role === 'admin' ? ['all', ...CLASS_LIST] : (scopedClasses.length ? scopedClasses : CLASS_LIST),
    []
  );
}

// Theme picker setup
const deskTheme = document.getElementById('teacher-theme-desktop');
const mobTheme = document.getElementById('teacher-theme-mob');
if (deskTheme) { deskTheme.innerHTML = `<span class="text-[10px] font-bold uppercase text-[var(--md-on-surface-variant)]">Theme</span>` + renderThemePickerHtml(); bindThemePicker(deskTheme); }
if (mobTheme) { mobTheme.innerHTML = renderThemePickerHtml(); bindThemePicker(mobTheme); }

document.getElementById('teacher-logout-btn')?.addEventListener('click', logout);
document.getElementById('teacher-logout-mob')?.addEventListener('click', logout);

document.querySelectorAll('.t-tab-btn, .t-mob-tab, .t-mob-sheet-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('t-more-sheet')?.classList.add('hidden');
    document.getElementById('t-more-sheet')?.classList.remove('flex');
    switchTab(btn.dataset.tab);
  });
});

document.querySelectorAll('.quick-jump-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.jump));
});

const moreSheet = document.getElementById('t-more-sheet');
document.getElementById('t-more-btn')?.addEventListener('click', () => { moreSheet.classList.remove('hidden'); moreSheet.classList.add('flex'); });
document.getElementById('t-more-close')?.addEventListener('click', () => { moreSheet.classList.add('hidden'); moreSheet.classList.remove('flex'); });
moreSheet?.addEventListener('click', (e) => { if (e.target === moreSheet) { moreSheet.classList.add('hidden'); moreSheet.classList.remove('flex'); } });

document.getElementById('dm-privacy-switch')?.addEventListener('change', async (e) => {
  try {
    const res = await apiRequest('/teacher/settings', {
      method: 'PUT',
      body: { allowStudentDms: e.target.checked }
    });
    if (currentTeacher) {
      currentTeacher.allowStudentDms = res.allowStudentDms;
      setCurrentUser(currentTeacher);
    }
    showToast(res.message || 'Privacy setting updated', 'success');
  } catch (err) {
    e.target.checked = !e.target.checked;
    showToast(err.message, 'error');
  }
});

document.getElementById('quick-new-lesson-btn')?.addEventListener('click', () => {
  switchTab('lessons');
  openLessonModal();
});
document.getElementById('quick-new-quiz-btn')?.addEventListener('click', () => {
  switchTab('quizzes');
  openQuizModal();
});

initIcons();
currentTeacher = await verifyTeacherSession();
if (currentTeacher) {
  hydrateTeacherProfileUI(currentTeacher);
  initLessonsModule(currentTeacher, refreshOverview);
  initQuizzesAndHomework(currentTeacher, refreshOverview);
  initClassRoomModule(currentTeacher, refreshOverview);
  refreshOverview();
}
