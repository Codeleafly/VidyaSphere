/**
 * Study Groups & Member Invitation UI Module
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, initIcons, showToast, bindModalBackdropAndEsc } from '/js/ui.js';
import { chatState, getDom, closeChannelsDrawer, loadAllStudents } from '/js/chat/state.js';
import { loadMessages } from '/js/chat/realtime.js';

export async function loadGroupsList() {
  const container = document.getElementById('groups-items-container');
  try {
    const res = await apiRequest('/chat/groups');
    const groups = res.groups || [];

    if (groups.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-slate-400 space-y-2">
          <p class="text-[11px]">No study groups yet.</p>
          <button id="create-first-group" class="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold rounded-lg text-[11px] transition">
            Create Study Group
          </button>
        </div>
      `;
      document.getElementById('create-first-group')?.addEventListener('click', () => {
        const m = document.getElementById('create-group-modal');
        m.classList.remove('hidden');
        m.classList.add('flex');
      });
      return;
    }

    container.innerHTML = groups.map(g => {
      const isPending = g.invite_status === 'pending';
      const academicDetail = `${g.creator_name ? 'By ' + g.creator_name : ''}${g.creator_class ? ' • ' + g.creator_class : ''}${g.creator_division ? ' (' + g.creator_division + ')' : ''}${g.creator_roll ? ' • #' + g.creator_roll : ''}`;

      return `
        <button class="group-item w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between transition hover:bg-slate-100/80 border border-transparent"
          data-group-id="${escapeHtml(g.id)}"
          data-name="${escapeHtml(g.name)}"
          data-my-role="${escapeHtml(g.my_role || 'member')}"
          data-invite-status="${escapeHtml(g.invite_status || 'accepted')}"
          data-creator-name="${escapeHtml(g.creator_name || '')}"
          data-creator-username="${escapeHtml(g.creator_username || '')}"
          data-creator-class="${escapeHtml(g.creator_class || '')}"
          data-creator-division="${escapeHtml(g.creator_division || '')}"
          data-creator-roll="${escapeHtml(g.creator_roll || '')}"
          data-member-count="${g.member_count || 1}">
          <div class="overflow-hidden pr-2">
            <div class="font-bold text-slate-800 truncate text-xs flex items-center gap-1.5">
              <i data-lucide="users" class="w-3.5 h-3.5 text-purple-600 shrink-0"></i>
              <span class="truncate">${escapeHtml(g.name)}</span>
            </div>
            ${academicDetail ? `<div class="text-[10px] text-indigo-600 font-medium truncate">${escapeHtml(academicDetail)}</div>` : ''}
          </div>
          <div class="shrink-0 text-right">
            ${isPending
              ? '<span class="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold animate-pulse">Invite</span>'
              : `<span class="text-[10px] text-slate-400 font-medium tabular-nums">${g.member_count || 1}</span>`
            }
          </div>
        </button>
      `;
    }).join('');

    initIcons();

    container.querySelectorAll('.group-item').forEach(btn => {
      btn.addEventListener('click', () => selectGroupConversation(btn.dataset));
    });
  } catch (err) {
    container.innerHTML = `<div class="p-3 text-rose-500 text-[11px] text-center">${escapeHtml(err.message)}</div>`;
  }
}

function selectGroupConversation(data) {
  const {
    channelNameEl, chatSubtitleEl, currentChatIcon,
    groupInfoBtn, groupMembersCountBadge, dmPermissionBanner,
    dmPermissionText, dmPermissionActions, chatInput, sendBtn, attachBtn
  } = getDom();

  chatState.currentChatType = 'group';
  chatState.currentGroupId = data.groupId;
  chatState.currentGroupName = data.name;
  chatState.currentGroupRole = data.myRole || 'member';
  chatState.currentGroupInviteStatus = data.inviteStatus || 'accepted';
  chatState.currentChannel = `grp_${data.groupId}`;
  chatState.activeDmData = null;

  closeChannelsDrawer();

  channelNameEl.textContent = data.name;
  const creatorAcademic = [
    data.creatorName ? `Created by ${data.creatorName}` : '',
    data.creatorClass ? `${data.creatorClass}${data.creatorDivision ? ' (' + data.creatorDivision + ')' : ''}` : '',
    data.creatorRoll ? `Roll #${data.creatorRoll}` : ''
  ].filter(Boolean).join(' • ');

  chatSubtitleEl.textContent = creatorAcademic || 'Custom Study Group • Auto-purge 7 days';
  currentChatIcon.innerHTML = `<i data-lucide="users" class="w-4 h-4 text-purple-600"></i>`;
  groupInfoBtn?.classList.remove('hidden');
  groupMembersCountBadge.textContent = `${data.memberCount || 1} Members`;

  if (chatState.currentGroupInviteStatus === 'pending') {
    dmPermissionBanner.classList.remove('hidden');
    dmPermissionText.textContent = `${data.creatorName || 'A classmate'} invited you to join "${data.name}". Accept invitation to join?`;
    dmPermissionActions.classList.remove('hidden');
    chatInput.disabled = true;
    chatInput.placeholder = 'Accept the group invitation above to send messages...';
    sendBtn.disabled = true;
    attachBtn.disabled = true;
  } else {
    dmPermissionBanner.classList.add('hidden');
    chatInput.disabled = false;
    chatInput.placeholder = `Message ${data.name}...`;
    sendBtn.disabled = false;
    attachBtn.disabled = false;
  }

  initIcons();
  loadMessages();
}

function switchGroupModalTab(tab) {
  const tabMembers = document.getElementById('tab-btn-group-members');
  const tabAdd = document.getElementById('tab-btn-group-add');
  const panelMembers = document.getElementById('panel-group-members');
  const panelAdd = document.getElementById('panel-group-add');

  if (tab === 'members') {
    tabMembers.className = 'py-1.5 rounded-lg bg-white text-purple-700 shadow-xs transition';
    tabAdd.className = 'py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1';
    panelMembers.classList.remove('hidden');
    panelAdd.classList.add('hidden');
    panelAdd.classList.remove('flex');
  } else {
    tabAdd.className = 'py-1.5 rounded-lg bg-white text-purple-700 shadow-xs transition flex items-center justify-center gap-1';
    tabMembers.className = 'py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition';
    panelMembers.classList.add('hidden');
    panelAdd.classList.remove('hidden');
    panelAdd.classList.add('flex');
    renderGroupClassmateSelector(chatState.allStudentsCache);
  }
  initIcons();
}

async function openGroupModal() {
  if (!chatState.currentGroupId) return;
  const modal = document.getElementById('group-members-modal');
  document.getElementById('group-modal-title').textContent = chatState.currentGroupName;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  switchGroupModalTab('members');
  await Promise.all([loadGroupMembers(chatState.currentGroupId), loadAllStudents().catch(() => [])]);
  initIcons();
}

function closeGroupModal() {
  const modal = document.getElementById('group-members-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  const searchEl = document.getElementById('add-member-search-input');
  if (searchEl) searchEl.value = '';
}

async function loadGroupMembers(groupId) {
  const container = document.getElementById('group-members-list-container');
  const deleteBtn = document.getElementById('delete-group-btn');
  container.innerHTML = '<p class="text-center text-slate-400 py-3 text-xs">Loading members...</p>';

  try {
    const res = await apiRequest(`/chat/groups/${encodeURIComponent(groupId)}/members`);
    chatState.currentGroupMembers = res.members || [];
    const acceptedCount = chatState.currentGroupMembers.filter(m => m.invite_status === 'accepted').length;
    document.getElementById('group-modal-member-count').textContent = `${acceptedCount} active (${chatState.currentGroupMembers.length} total)`;
    document.getElementById('group-members-count-badge').textContent = `${acceptedCount} Members`;

    const me = chatState.currentGroupMembers.find(m => m.user_id === chatState.user?.id);
    if (me) chatState.currentGroupRole = me.member_role;
    const isGroupAdmin = chatState.currentGroupRole === 'admin';

    deleteBtn.classList.toggle('hidden', !isGroupAdmin);
    renderGroupMembers(chatState.currentGroupMembers, isGroupAdmin);
  } catch (err) {
    container.innerHTML = `<div class="p-2 text-center text-rose-500 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

function renderGroupMembers(members, isGroupAdmin) {
  const container = document.getElementById('group-members-list-container');
  if (members.length === 0) {
    container.innerHTML = '<p class="text-center text-slate-400 py-3 text-xs">No members found.</p>';
    return;
  }

  container.innerHTML = members.map(m => {
    const isMe = m.user_id === chatState.user?.id;
    const isAdmin = m.member_role === 'admin';
    const isPending = m.invite_status === 'pending';
    const canRemove = isGroupAdmin && !isMe;

    const academicBadge = [
      m.class_name ? `${m.class_name}${m.division ? ' (' + m.division + ')' : ''}` : '',
      m.roll_number ? `Roll #${m.roll_number}` : '',
      `@${m.username}`
    ].filter(Boolean).join(' • ');

    return `
      <div class="py-2 px-2.5 rounded-xl flex items-center justify-between hover:bg-slate-50 transition">
        <div class="overflow-hidden">
          <div class="font-bold text-slate-800 text-xs truncate flex items-center gap-1.5 flex-wrap">
            ${escapeHtml(m.full_name)}
            ${isMe ? '<span class="text-[9px] text-slate-400 font-normal">(You)</span>' : ''}
            ${isAdmin ? '<span class="text-[8px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold uppercase">Admin</span>' : ''}
            ${isPending ? '<span class="text-[8px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">Pending</span>' : ''}
          </div>
          <div class="text-[10px] text-indigo-600 font-medium truncate mt-0.5">${escapeHtml(academicBadge)}</div>
        </div>
        ${canRemove ? `
          <button class="remove-member-btn text-[10px] text-rose-600 hover:text-rose-800 font-bold px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 transition shrink-0"
            data-user-id="${escapeHtml(m.user_id)}" data-name="${escapeHtml(m.full_name)}">
            ${isPending ? 'Cancel' : 'Remove'}
          </button>
        ` : ''}
      </div>
    `;
  }).join('');

  initIcons();

  container.querySelectorAll('.remove-member-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Remove ${btn.dataset.name} from this study group?`)) return;
      try {
        await apiRequest(`/chat/groups/${encodeURIComponent(chatState.currentGroupId)}/members/${encodeURIComponent(btn.dataset.userId)}`, { method: 'DELETE' });
        showToast(`${btn.dataset.name} removed from group`, 'info');
        await loadGroupMembers(chatState.currentGroupId);
        renderGroupClassmateSelector(chatState.allStudentsCache);
        loadGroupsList();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });
}

function renderGroupClassmateSelector(students) {
  const selector = document.getElementById('group-classmate-selector');
  if (!selector) return;
  const list = students || chatState.allStudentsCache || [];
  if (list.length === 0) {
    selector.innerHTML = '<p class="text-center text-slate-400 py-6 text-[11px]">No classmates found.</p>';
    return;
  }

  const existingMap = new Map();
  chatState.currentGroupMembers.forEach(m => existingMap.set(m.user_id, m.invite_status || 'accepted'));

  selector.innerHTML = list.slice(0, 30).map(s => {
    const isCurrentMember = existingMap.has(s.id);
    const status = existingMap.get(s.id);
    const isMe = s.id === chatState.user?.id;

    let actionButton = '';
    if (isMe) {
      actionButton = '<span class="text-[9px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-bold">You</span>';
    } else if (isCurrentMember) {
      actionButton = status === 'accepted'
        ? '<span class="text-[9px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">In Group</span>'
        : '<span class="text-[9px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">Invited</span>';
    } else {
      actionButton = `
        <button class="invite-classmate-btn px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-600 hover:text-white text-purple-700 font-bold text-[10px] transition shrink-0"
          data-user-id="${escapeHtml(s.id)}" data-user-name="${escapeHtml(s.full_name)}">
          + Invite
        </button>
      `;
    }

    const academicDetail = [
      s.class_name ? `${s.class_name}${s.division ? ' (' + s.division + ')' : ''}` : '',
      s.roll_number ? `Roll #${s.roll_number}` : '',
      `@${s.username}`
    ].filter(Boolean).join(' • ');

    return `
      <div class="py-2 px-1 flex items-center justify-between hover:bg-slate-50 rounded-lg transition gap-2">
        <div class="overflow-hidden">
          <div class="font-bold text-slate-800 text-[11px] truncate">${escapeHtml(s.full_name)}</div>
          <div class="text-[9px] text-indigo-600 font-medium truncate">${escapeHtml(academicDetail)}</div>
        </div>
        ${actionButton}
      </div>
    `;
  }).join('');

  initIcons();

  selector.querySelectorAll('.invite-classmate-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        btn.disabled = true;
        btn.textContent = 'Inviting...';
        await apiRequest(`/chat/groups/${encodeURIComponent(chatState.currentGroupId)}/members`, {
          method: 'POST',
          body: { targetUserId: btn.dataset.userId }
        });
        showToast(`Invitation sent to ${btn.dataset.userName}!`, 'success');
        await loadGroupMembers(chatState.currentGroupId);
        renderGroupClassmateSelector(chatState.allStudentsCache);
        loadGroupsList();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '+ Invite';
        showToast(e.message, 'error');
      }
    });
  });
}

export function initGroupsUi() {
  const { groupInfoBtn } = getDom();
  const groupMembersModal = document.getElementById('group-members-modal');
  const createGroupModal = document.getElementById('create-group-modal');
  const manualInput = document.getElementById('manual-group-invite-input');
  const manualBtn = document.getElementById('manual-group-invite-btn');

  groupInfoBtn?.addEventListener('click', openGroupModal);
  document.getElementById('close-group-members-modal')?.addEventListener('click', closeGroupModal);
  bindModalBackdropAndEsc(groupMembersModal, closeGroupModal);

  document.getElementById('tab-btn-group-members')?.addEventListener('click', () => switchGroupModalTab('members'));
  document.getElementById('tab-btn-group-add')?.addEventListener('click', () => switchGroupModalTab('add'));

  document.getElementById('add-member-search-input')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderGroupClassmateSelector(chatState.allStudentsCache);
      return;
    }
    const filtered = chatState.allStudentsCache.filter(s =>
      (s.full_name && s.full_name.toLowerCase().includes(q)) ||
      (s.username && s.username.toLowerCase().includes(q)) ||
      (s.roll_number && s.roll_number.toString().includes(q)) ||
      (s.class_name && s.class_name.toLowerCase().includes(q)) ||
      (s.division && s.division.toLowerCase().includes(q))
    );
    renderGroupClassmateSelector(filtered);
  });

  const handleManualInvite = async () => {
    const val = manualInput.value.trim();
    if (!val) {
      showToast('Please enter a roll number or username', 'warning');
      return;
    }
    try {
      manualBtn.disabled = true;
      manualBtn.textContent = 'Inviting...';
      await apiRequest(`/chat/groups/${encodeURIComponent(chatState.currentGroupId)}/members`, {
        method: 'POST',
        body: { query: val }
      });
      showToast(`Invitation sent to ${val}!`, 'success');
      manualInput.value = '';
      await loadGroupMembers(chatState.currentGroupId);
      renderGroupClassmateSelector(chatState.allStudentsCache);
      loadGroupsList();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      manualBtn.disabled = false;
      manualBtn.textContent = 'Invite';
    }
  };

  manualBtn?.addEventListener('click', handleManualInvite);
  manualInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualInvite();
    }
  });

  document.getElementById('leave-group-btn')?.addEventListener('click', async () => {
    if (!chatState.currentGroupId || !confirm(`Leave ${chatState.currentGroupName}?`)) return;
    try {
      await apiRequest(`/chat/groups/${encodeURIComponent(chatState.currentGroupId)}/members/${encodeURIComponent(chatState.user.id)}`, { method: 'DELETE' });
      showToast('You left the study group', 'info');
      closeGroupModal();
      loadGroupsList();
      document.querySelector('.channel-item[data-channel="school"]')?.click();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('delete-group-btn')?.addEventListener('click', async () => {
    if (!chatState.currentGroupId || !confirm(`Permanently delete ${chatState.currentGroupName}? All group messages will be removed.`)) return;
    try {
      await apiRequest(`/chat/groups/${encodeURIComponent(chatState.currentGroupId)}`, { method: 'DELETE' });
      showToast('Study group deleted', 'info');
      closeGroupModal();
      loadGroupsList();
      document.querySelector('.channel-item[data-channel="school"]')?.click();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  const closeCreateGroup = () => {
    createGroupModal.classList.add('hidden');
    createGroupModal.classList.remove('flex');
  };

  document.getElementById('create-group-btn')?.addEventListener('click', () => {
    createGroupModal.classList.remove('hidden');
    createGroupModal.classList.add('flex');
  });
  document.getElementById('close-group-modal')?.addEventListener('click', closeCreateGroup);
  bindModalBackdropAndEsc(createGroupModal, closeCreateGroup);

  document.getElementById('group-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('group-name-input').value.trim();
    const description = document.getElementById('group-desc-input').value.trim();
    if (!name) return;
    try {
      await apiRequest('/chat/groups', { method: 'POST', body: { name, description } });
      showToast('Study group created!', 'success');
      e.target.reset();
      closeCreateGroup();
      loadGroupsList();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
