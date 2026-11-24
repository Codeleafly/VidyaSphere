/**
 * Consent-First 1-on-1 Direct Messaging UI Module
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, initIcons, showToast, bindModalBackdropAndEsc } from '/js/ui.js';
import { chatState, getDom, closeChannelsDrawer, loadAllStudents } from '/js/chat/state.js';
import { loadMessages } from '/js/chat/realtime.js';

export async function loadDmsList() {
  const container = document.getElementById('dms-items-container');
  try {
    const res = await apiRequest('/chat/dms');
    const dms = res.dms || [];

    if (dms.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 px-2 text-slate-400 space-y-2">
          <p class="text-[11px]">No direct messages yet.</p>
          <button id="start-first-dm" class="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-[11px] transition">
            Find a Classmate
          </button>
        </div>
      `;
      document.getElementById('start-first-dm')?.addEventListener('click', openNewDmModal);
      return;
    }

    container.innerHTML = dms.map(dm => {
      const isPending = dm.status === 'pending';
      const isIncoming = isPending && !dm.requestedByMe;
      const academicDetail = `${dm.partner.className || ''}${dm.partner.division ? ' (' + dm.partner.division + ')' : ''}${dm.partner.rollNumber ? ' • Roll #' + dm.partner.rollNumber : ''}`;

      return `
        <button class="dm-item w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between transition hover:bg-slate-100/80 border border-transparent"
          data-dm-id="${escapeHtml(dm.id)}"
          data-partner-name="${escapeHtml(dm.partner.fullName)}"
          data-partner-username="${escapeHtml(dm.partner.username)}"
          data-partner-class="${escapeHtml(dm.partner.className || '')}"
          data-partner-division="${escapeHtml(dm.partner.division || '')}"
          data-partner-roll="${escapeHtml(dm.partner.rollNumber || '')}"
          data-status="${escapeHtml(dm.status)}"
          data-requested-by-me="${dm.requestedByMe}">
          <div class="overflow-hidden pr-2">
            <div class="font-bold text-slate-800 truncate text-xs">
              ${escapeHtml(dm.partner.fullName)}
            </div>
            ${academicDetail ? `<div class="text-[10px] text-indigo-600 font-medium truncate">${escapeHtml(academicDetail)}</div>` : ''}
            <div class="text-[10px] text-slate-400 truncate">
              ${dm.lastMessage ? escapeHtml(dm.lastMessage) : (isPending ? 'Pending request...' : 'Active conversation')}
            </div>
          </div>
          <div class="shrink-0 text-right">
            ${isIncoming
              ? '<span class="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold animate-pulse">Request</span>'
              : (isPending
                ? '<span class="text-[9px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">Pending</span>'
                : '<span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>')
            }
          </div>
        </button>
      `;
    }).join('');

    container.querySelectorAll('.dm-item').forEach(btn => {
      btn.addEventListener('click', () => selectDmConversation({ ...btn.dataset }));
    });
  } catch (err) {
    container.innerHTML = `<div class="p-3 text-rose-500 text-[11px] text-center">${escapeHtml(err.message)}</div>`;
  }
}

export function selectDmConversation(data) {
  closeChannelsDrawer();
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

  channelNameEl.textContent = data.partnerName;
  const detailParts = [
    data.partnerClass ? `${data.partnerClass}${data.partnerDivision ? ' (' + data.partnerDivision + ')' : ''}` : '',
    data.partnerRoll ? `Roll #${data.partnerRoll}` : '',
    `@${data.partnerUsername}`
  ].filter(Boolean);
  chatSubtitleEl.textContent = detailParts.length > 0 ? detailParts.join(' • ') : `@${data.partnerUsername} • 1-on-1 DM`;
  currentChatIcon.innerHTML = `<i data-lucide="lock" class="w-4 h-4 text-emerald-600"></i>`;
  initIcons();

  if (data.status === 'pending') {
    dmPermissionBanner.classList.remove('hidden');
    const isRequestedByMe = data.requestedByMe === 'true' || data.requestedByMe === true;

    if (isRequestedByMe) {
      dmPermissionText.textContent = `Invitation sent to ${data.partnerName}. Chat will unlock once they accept.`;
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
      picker.innerHTML = '<p class="text-center text-slate-400 py-4 text-xs animate-pulse">Loading classmates...</p>';
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
          <p class="text-[11px] text-slate-500">Enter student's exact username or roll #:</p>
          <div class="flex gap-1.5">
            <input type="text" id="manual-username-input" placeholder="e.g. 21 or aarav_10a" class="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs">
            <button id="send-request-manual" class="px-3 py-1.5 bg-indigo-600 text-white font-bold rounded-lg text-xs">Invite</button>
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
    picker.innerHTML = '<p class="text-center text-slate-400 py-4 text-xs">No other registered classmates found yet.</p>';
    return;
  }

  picker.innerHTML = list.slice(0, 50).map(s => {
    const academicDetail = [
      s.class_name ? `${s.class_name}${s.division ? ' (' + s.division + ')' : ''}` : '',
      s.roll_number ? `Roll #${s.roll_number}` : '',
      `@${s.username}`
    ].filter(Boolean).join(' • ');

    return `
      <div class="py-2.5 px-2 flex items-center justify-between hover:bg-slate-50 rounded-xl transition">
        <div class="overflow-hidden pr-2">
          <div class="font-bold text-slate-800 text-xs">${escapeHtml(s.full_name)}</div>
          <div class="text-[10px] text-indigo-600 font-medium truncate mt-0.5">${escapeHtml(academicDetail)}</div>
        </div>
        <button class="invite-student-btn px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 font-bold text-xs transition shrink-0"
          data-user-id="${escapeHtml(s.id)}">
          Chat
        </button>
      </div>
    `;
  }).join('');

  picker.querySelectorAll('.invite-student-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        btn.disabled = true;
        btn.textContent = 'Sending...';
        await apiRequest('/chat/dms/request', { method: 'POST', body: { targetUserId: btn.dataset.userId } });
        showToast('Chat request sent!', 'success');
        closeNewDmModal();
        document.querySelector('.chat-tab-btn[data-target="dms-list"]')?.click();
        loadDmsList();
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
