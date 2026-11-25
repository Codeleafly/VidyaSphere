/**
 * Teacher Studio Main Controller
 * Supports Teachers, Lead Admin & Secondary Admins cleanly without noisy list dumps.
 */

import { apiRequest } from '/js/api.js';
import { logout, setCurrentUser } from '/js/auth.js';
import { openAccountModal } from '/js/layout.js';
import {
  CLASS_LIST, SUBJECT_LIST, escapeHtml, initIcons, initM3Theme,
  renderThemePickerHtml, bindThemePicker, showToast
} from '/js/ui.js';
import { initLessonsModule, loadTeacherLessons, loadTeacherNotes, openLessonModal } from '/js/teacher/lessons.js';
import { initQuizzesAndHomework, loadTeacherQuizzes, loadTeacherHomework, openQuizModal } from '/js/teacher/quizzes.js';
import { initClassRoomModule, loadTeacherNotices, loadTeacherUnitTests, loadClassRoster } from '/js/teacher/classRoom.js';

initM3Theme();

let currentTeacher = null;

/**
 * Populate dropdown cleanly with <optgroup label="Your Assigned"> first if assigned items exist.
 */
export function populateSelectOptions(selectEl, allItems, assigned = []) {
  if (!selectEl) return;
  const assignedSet = new Set((assigned || []).filter(Boolean));
  const preferred = (assigned || []).filter(Boolean);
  const rest = allItems.filter(item => !assignedSet.has(item));

  if (preferred.length > 0 && rest.length > 0) {
    selectEl.innerHTML = `
      <optgroup label="Your Assigned">
        ${preferred.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('')}
      </optgroup>
      <optgroup label="All School">
        ${rest.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('')}
      </optgroup>
    `;
  } else {
    const unique = [...new Set([...preferred, ...allItems].filter(Boolean))];
    selectEl.innerHTML = unique.map(val => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('');
  }
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
    if (pill && (currentTeacher?.teacherType === 'class' || currentTeacher?.role === 'admin')) {
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
  if (tabId === 'lessons') {
    loadTeacherLessons(currentTeacher);
    loadTeacherNotes(currentTeacher);
  }
  if (tabId === 'quizzes') {
    loadTeacherQuizzes(currentTeacher);
    loadTeacherHomework(currentTeacher);
  }
  if (tabId === 'notices') {
    loadTeacherNotices(currentTeacher);
    if (currentTeacher?.teacherType === 'class' || currentTeacher?.role === 'admin') {
      loadTeacherUnitTests(currentTeacher);
    }
  }
  if (tabId === 'roster' && (currentTeacher?.teacherType === 'class' || currentTeacher?.role === 'admin')) {
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
  const isAdmin = user.role === 'admin';
  const isClassTeacher = user.teacherType === 'class';
  const canManageRosterAndTests = isAdmin || isClassTeacher;

  const typeLabel = isAdmin
    ? 'Admin'
    : (isClassTeacher ? `Class Teacher • ${user.className}${user.division ? ' (' + user.division + ')' : ''}` : 'Teacher');

  document.getElementById('teacher-display-name').textContent = user.fullName || user.username;
  document.getElementById('teacher-display-type').textContent = typeLabel;
  document.getElementById('teacher-mob-badge').textContent = typeLabel;
  document.getElementById('home-role-pill').textContent = typeLabel;
  document.getElementById('home-greeting').textContent = user.fullName || 'Teacher Studio';

  // Concise info summary instead of dumping all subjects/classes
  const classes = user.assignedClasses || [];
  const subjects = user.assignedSubjects || [];
  const summaryEl = document.getElementById('home-scope-summary');
  const toggleBtn = document.getElementById('toggle-scope-details-btn');
  const chipsEl = document.getElementById('home-assignments-chips');
  const bioEl = document.getElementById('home-teacher-bio');

  if (isAdmin) {
    summaryEl.textContent = 'Full School & Faculty Access';
  } else {
    const parts = [];
    if (user.teacherDesignation) parts.push(user.teacherDesignation);
    if (classes.length || subjects.length) {
      parts.push(`${classes.length} Class${classes.length === 1 ? '' : 'es'} • ${subjects.length} Subject${subjects.length === 1 ? '' : 's'}`);
    }
    summaryEl.textContent = parts.join(' • ') || 'Faculty Workspace';

    if (classes.length || subjects.length) {
      toggleBtn?.classList.remove('hidden');
      chipsEl.innerHTML = [
        ...classes.map(c => `<span class="px-2.5 py-0.5 rounded-full bg-white text-[11px] font-bold border border-[var(--md-outline)]">${escapeHtml(c)}</span>`),
        ...subjects.map(s => `<span class="px-2.5 py-0.5 rounded-full bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] text-[11px] font-bold">${escapeHtml(s)}</span>`),
      ].join('');
    }
  }

  if (user.teacherInfo && bioEl) {
    bioEl.textContent = user.teacherInfo;
    bioEl.classList.remove('hidden');
  }

  toggleBtn?.addEventListener('click', () => {
    const hidden = chipsEl.classList.toggle('hidden');
    chipsEl.classList.toggle('flex', !hidden);
    toggleBtn.textContent = hidden ? 'Details' : 'Hide details';
  });

  const dmSwitch = document.getElementById('dm-privacy-switch');
  if (dmSwitch) dmSwitch.checked = user.allowStudentDms !== false;

  if (canManageRosterAndTests) {
    document.getElementById('nav-roster-desktop')?.classList.remove('hidden');
    document.getElementById('nav-roster-mob')?.classList.remove('hidden');
    document.getElementById('class-teacher-tests-panel')?.classList.remove('hidden');
  }

  if (isAdmin) {
    document.getElementById('nav-admin-desktop')?.classList.remove('hidden');
    document.getElementById('nav-admin-mob')?.classList.remove('hidden');
    document.getElementById('nav-admin-mob-top')?.classList.remove('hidden');
    document.getElementById('nav-admin-mob-top')?.classList.add('inline-flex');
    document.getElementById('t-exam-admin-class-wrap')?.classList.remove('hidden');
    const examClsSel = document.getElementById('t-exam-class-select');
    if (examClsSel) populateSelectOptions(examClsSel, ['All Classes', ...CLASS_LIST], []);
    const rosterClsFilter = document.getElementById('t-roster-class-filter');
    if (rosterClsFilter) {
      rosterClsFilter.classList.remove('hidden');
      rosterClsFilter.innerHTML = `<option value="">All Classes</option>` + CLASS_LIST.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
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
    isAdmin ? ['all', ...CLASS_LIST] : (scopedClasses.length ? scopedClasses : CLASS_LIST),
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

document.getElementById('teacher-profile-btn')?.addEventListener('click', () => currentTeacher && openAccountModal(currentTeacher));
document.getElementById('teacher-profile-mob')?.addEventListener('click', () => {
  moreSheet?.classList.add('hidden');
  moreSheet?.classList.remove('flex');
  if (currentTeacher) openAccountModal(currentTeacher);
});

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
