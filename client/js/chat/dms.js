/**
 * Consent-First 1-on-1 Direct Messaging UI Module (Material You)
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, initIcons, showToast, bindModalBackdropAndEsc, formatMemberSubline, renderRoleBadgeHtml, isRootUser } from '/js/ui.js';
import { chatState, getDom, closeChannelsDrawer, loadAllStudents } from '/js/chat/state.js';
import { loadMessages, clearReplyTarget } from '/js/chat/realtime.js';

export async function loadDmsList(openDmId = null) {
  const container = document.getElementById('dms-items-container');
  const badgeEl = document.getElementById('dms-badge-count');
  try {
    const res = await apiRequest('/chat/dms');
    const dms = res.dms || [];

    const incomingCount = dms.filter(d => d.status === 'pending' && !d.requestedByMe).length;
    if (badgeEl) {
      badgeEl.textContent = incomingCount;
      badgeEl.classList.toggle('hidden', incomingCount === 0);
    }

    if (dms.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 px-2 text-slate-400 space-y-2.5">
          <p class="text-[11px]">No direct messages yet.</p>
          <button id="start-first-dm" class="m3-btn-tonal px-3.5 py-1.5 text-[11px]">
            Find Member
          </button>
        </div>
      `;
      document.getElementById('start-first-dm')?.addEventListener('click', openNewDmModal);
      return;
    }

    container.innerHTML = dms.map(dm => {
      const isPending = dm.status === 'pending';
      const isIncoming = isPending && !dm.requestedByMe;
      const partnerIsRoot = isRootUser(dm.partner);
      const academicDetail = formatMemberSubline(dm.partner);
      const isActive = chatState.currentChatType === 'dm' && chatState.activeDmData?.dmId === dm.id;

      return `
        <button class="dm-item w-full px-3 py-2.5 rounded-2xl text-left flex items-center justify-between transition border ${
          isActive
            ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] border-transparent'
            : 'bg-transparent hover:bg-[var(--md-surface-container)] border-transparent'
        }"
          data-dm-id="${escapeHtml(dm.id)}"
          data-partner-name="${escapeHtml(dm.partner.fullName)}"
          data-partner-username="${escapeHtml(dm.partner.username)}"
          data-partner-role="${escapeHtml(dm.partner.role || 'student')}"
          data-partner-teacher-type="${escapeHtml(dm.partner.teacherType || '')}"
          data-partner-is-root="${partnerIsRoot}"
          data-partner-class="${escapeHtml(dm.partner.className || '')}"
          data-partner-division="${escapeHtml(dm.partner.division || '')}"
          data-partner-roll="${escapeHtml(dm.partner.rollNumber || '')}"
          data-status="${escapeHtml(dm.status)}"
          data-requested-by-me="${dm.requestedByMe}">
          <div class="overflow-hidden pr-2 flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] font-extrabold text-xs flex items-center justify-center shrink-0">
              ${escapeHtml((dm.partner.fullName || 'U').charAt(0).toUpperCase())}
            </div>
            <div class="overflow-hidden">
              <div class="font-bold truncate text-xs flex items-center gap-1.5">
                <span class="truncate">${escapeHtml(dm.partner.fullName)}</span>
                ${renderRoleBadgeHtml(dm.partner.role, dm.partner.teacherType, partnerIsRoot)}
              </div>
              <div class="text-[10px] text-[var(--md-primary)] font-semibold truncate">${escapeHtml(academicDetail || '@' + dm.partner.username)}</div>
              <div class="text-[10px] text-slate-400 truncate">
                ${dm.lastMessage ? escapeHtml(dm.lastMessage) : (isPending ? 'Pending request...' : 'Tap to message')}
              </div>
            </div>
          </div>
          <div class="shrink-0 text-right">
            ${isIncoming
              ? '<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold animate-pulse">Request</span>'
              : (isPending
                ? '<span class="text-[9px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">Pending</span>'
                : '<span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>')
            }
          </div>
        </button>
      `;
    }).join('');

    container.querySelectorAll('.dm-item').forEach(btn => {
      btn.addEventListener('click', () => selectDmConversation({ ...btn.dataset }));
    });

    if (openDmId) {
      const targetBtn = Array.from(container.querySelectorAll('.dm-item')).find(b => b.dataset.dmId === openDmId);
      if (targetBtn) selectDmConversation({ ...targetBtn.dataset });
    }
  } catch (err) {
    container.innerHTML = `<div class="p-3 text-rose-500 text-[11px] text-center">${escapeHtml(err.message)}</div>`;
  }
}

export function selectDmConversation(data) {
  closeChannelsDrawer();
  clearReplyTarget();
  const {
    groupInfoBtn, channelNameEl, chatSubtitleEl, currentChatIcon,
    dmPermissionBanner, dmPermissionText, dmPermissionActions,
    chatInput, sendBtn, attachBtn
  } = getDom();

  chatState.currentChatType = 'dm';
  const rawDmId = data.dmId || '';
  chatState.currentChannel = rawDmId.startsWith('dm_') ? rawDmId : `dm_${rawDmId}`;
  chatState.activeDmData = data;
  chatState.currentGroupId = null;
  groupInfoBtn?.classList.add('hidden');

  const isPartnerRoot = data.partnerIsRoot === 'true' || data.partnerIsRoot === true || data.partnerUsername === 'admin';
  const isPartnerAdmin = isPartnerRoot || data.partnerRole === 'admin';

  channelNameEl.textContent = data.partnerName;
  if (isPartnerAdmin) {
    chatSubtitleEl.textContent = `Admin • @${data.partnerUsername} • Private 1-on-1`;
  } else {
    const detailParts = [
      data.partnerClass ? `${data.partnerClass}${data.partnerDivision ? ' (' + data.partnerDivision + ')' : ''}` : '',
      data.partnerRoll ? `Roll #${data.partnerRoll}` : '',
      `@${data.partnerUsername}`
    ].filter(Boolean);
    chatSubtitleEl.textContent = detailParts.length > 0 ? detailParts.join(' • ') : `@${data.partnerUsername} • 1-on-1 DM`;
  }

  currentChatIcon.innerHTML = `<i data-lucide="lock" class="w-4 h-4"></i>`;
  initIcons();

  if (data.status === 'pending') {
    dmPermissionBanner.classList.remove('hidden');
    const isRequestedByMe = data.requestedByMe === 'true' || data.requestedByMe === true;

    if (isRequestedByMe) {
      dmPermissionText.textContent = `Invitation sent to ${data.partnerName}. Chat unlocks once they accept.`;
      dmPermissionActions.classList.add('hidden');
      chatInput.disabled = true;
      chatInput.placeholder = `Waiting for ${data.partnerName} to accept...`;
      sendBtn.disabled = true;
      attachBtn.disabled = true;
    } else {
      dmPermissionText.textContent = `${data.partnerName} wants to chat with you. Accept invitation?`;
      dmPermissionActions.classList.remove('hidden');
      chatInput.disabled = true;
      chatInput.placeholder = 'Accept the request above to start messaging...';
      sendBtn.disabled = true;
      attachBtn.disabled = true;
    }
  } else {
    dmPermissionBanner.classList.add('hidden');
    chatInput.disabled = false;
    chatInput.placeholder = `Message ${data.partnerName}...`;
    sendBtn.disabled = false;
    attachBtn.disabled = false;
  }

  document.querySelectorAll('.dm-item').forEach(b => {
    const active = b.dataset.dmId === rawDmId.replace('dm_', '');
    b.className = `dm-item w-full px-3 py-2.5 rounded-2xl text-left flex items-center justify-between transition border ${
      active
        ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] border-transparent'
        : 'bg-transparent hover:bg-[var(--md-surface-container)] border-transparent'
    }`;
  });

  loadMessages();
}

export async function openNewDmModal() {
  const dmModal = document.getElementById('new-dm-modal');
  dmModal.classList.remove('hidden');
  dmModal.classList.add('flex');

  const searchInput = document.getElementById('student-search-input');
  if (searchInput) searchInput.value = '';

  const picker = document.getElementById('student-picker-list');
  if (picker) {
    if (!chatState.allStudentsCache.length) {
      picker.innerHTML = '<p class="text-center text-slate-400 py-4 text-xs animate-pulse">Loading members...</p>';
    } else {
      renderStudentPicker(chatState.allStudentsCache);
    }
  }

  try {
    const students = await loadAllStudents();
    if (!dmModal.classList.contains('hidden')) renderStudentPicker(students);
  } catch {
    if (picker && !chatState.allStudentsCache.length) {
      picker.innerHTML = `
        <div class="space-y-2 pt-2">
          <p class="text-[11px] text-slate-500">Enter exact @username or roll #:</p>
          <div class="flex gap-1.5">
            <input type="text" id="manual-username-input" placeholder="e.g. 21 or aarav_10a" class="m3-input flex-1 px-3 py-1.5 border border-[var(--md-outline)] rounded-full text-xs">
            <button id="send-request-manual" class="m3-btn-primary px-3.5 py-1.5 text-xs">Invite</button>
          </div>
        </div>
      `;
      document.getElementById('send-request-manual')?.addEventListener('click', async () => {
        const q = document.getElementById('manual-username-input').value.trim();
        if (!q) return;
        try {
          await apiRequest('/chat/dms/request', { method: 'POST', body: { query: q } });
          showToast('Chat request sent!', 'success');
          closeNewDmModal();
          loadDmsList();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }
  }
}

export function closeNewDmModal() {
  const dmModal = document.getElementById('new-dm-modal');
  dmModal.classList.add('hidden');
  dmModal.classList.remove('flex');
}

export function renderStudentPicker(students) {
  const picker = document.getElementById('student-picker-list');
  if (!picker) return;
  const list = students || chatState.allStudentsCache || [];
  if (list.length === 0) {
    picker.innerHTML = '<p class="text-center text-slate-400 py-4 text-xs">No matching school members found.</p>';
    return;
  }

  picker.innerHTML = list.slice(0, 60).map(s => {
    const isTeacher = s.role === 'teacher';
    const isRoot = isRootUser(s);
    const dmsDisabled = isTeacher && s.allow_student_dms === 0 && chatState.user?.role === 'student';
    const subline = formatMemberSubline(s);

    return `
      <div class="py-2.5 px-2 flex items-center justify-between hover:bg-[var(--md-surface-container)] rounded-2xl transition gap-2">
        <div class="overflow-hidden pr-2">
          <div class="font-bold text-xs flex items-center gap-1.5 flex-wrap">
            <span>${escapeHtml(s.full_name)}</span>
            ${renderRoleBadgeHtml(s.role, s.teacher_type, isRoot)}
          </div>
          <div class="text-[10px] text-[var(--md-primary)] font-medium truncate mt-0.5">${escapeHtml(subline)} • @${escapeHtml(s.username)}</div>
        </div>
        ${dmsDisabled
          ? `<span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 font-bold text-[10px] shrink-0">DMs Off</span>`
          : `<button class="invite-student-btn m3-btn-tonal px-3.5 py-1.5 text-xs shrink-0"
              data-user-id="${escapeHtml(s.id)}">
              Chat
            </button>`}
      </div>
    `;
  }).join('');

  picker.querySelectorAll('.invite-student-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        btn.disabled = true;
        btn.textContent = 'Sending...';
        const res = await apiRequest('/chat/dms/request', { method: 'POST', body: { targetUserId: btn.dataset.userId } });
        showToast(res.message || 'Chat request sent!', 'success');
        closeNewDmModal();
        document.querySelector('.chat-tab-btn[data-target="dms-list"]')?.click();
        await loadDmsList(res.id);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Chat';
        showToast(e.message, 'error');
      }
    });
  });
}

export function initDmUi() {
  document.getElementById('open-new-dm-btn')?.addEventListener('click', openNewDmModal);
  document.getElementById('open-new-dm-mob')?.addEventListener('click', openNewDmModal);
  document.getElementById('close-dm-modal')?.addEventListener('click', closeNewDmModal);
  bindModalBackdropAndEsc(document.getElementById('new-dm-modal'), closeNewDmModal);

  document.getElementById('student-search-input')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = chatState.allStudentsCache.filter(s =>
      (s.full_name && s.full_name.toLowerCase().includes(q)) ||
      (s.username && s.username.toLowerCase().includes(q)) ||
      (s.roll_number && s.roll_number.toString().includes(q)) ||
      (s.class_name && s.class_name.toLowerCase().includes(q))
    );
    renderStudentPicker(filtered);
  });
}
