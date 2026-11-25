/**
 * Study Groups & Consent-First Membership UI Module (Material You)
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, initIcons, showToast, bindModalBackdropAndEsc, formatMemberSubline, renderRoleBadgeHtml, isRootUser } from '/js/ui.js';
import { chatState, getDom, closeChannelsDrawer, loadAllStudents } from '/js/chat/state.js';
import { loadMessages, clearReplyTarget } from '/js/chat/realtime.js';

export async function loadGroupsList(openGroupId = null) {
  const container = document.getElementById('groups-items-container');
  const badgeEl = document.getElementById('groups-badge-count');
  try {
    const res = await apiRequest('/chat/groups');
    const groups = res.groups || [];

    const pendingCount = groups.filter(g => g.invite_status === 'pending').length;
    if (badgeEl) {
      badgeEl.textContent = pendingCount;
      badgeEl.classList.toggle('hidden', pendingCount === 0);
    }

    if (groups.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-slate-400 space-y-2.5">
          <p class="text-[11px]">No study groups yet.</p>
          <button id="create-first-group" class="m3-btn-tonal px-3.5 py-1.5 text-[11px]">
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
      const isCreatorRoot = g.creator_is_root_admin === 1 || g.creator_username === 'admin';
      const creatorScope = (isCreatorRoot || g.creator_role === 'admin')
        ? 'Admin'
        : [g.creator_class ? `${g.creator_class}${g.creator_division ? ' (' + g.creator_division + ')' : ''}` : '', g.creator_roll ? `#${g.creator_roll}` : ''].filter(Boolean).join(' • ');
      const academicDetail = g.creator_name ? `By ${g.creator_name}${creatorScope ? ' • ' + creatorScope : ''}` : '';
      const isActive = chatState.currentChatType === 'group' && chatState.currentGroupId === g.id;

      return `
        <button class="group-item w-full px-3 py-2.5 rounded-2xl text-left flex items-center justify-between transition border ${
          isActive
            ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] border-transparent'
            : 'bg-transparent hover:bg-[var(--md-surface-container)] border-transparent'
        }"
          data-group-id="${escapeHtml(g.id)}"
          data-name="${escapeHtml(g.name)}"
          data-my-role="${escapeHtml(g.my_role || 'member')}"
          data-invite-status="${escapeHtml(g.invite_status || 'accepted')}"
          data-creator-name="${escapeHtml(g.creator_name || '')}"
          data-creator-username="${escapeHtml(g.creator_username || '')}"
          data-creator-role="${escapeHtml(g.creator_role || 'student')}"
          data-creator-is-root="${isCreatorRoot}"
          data-creator-class="${escapeHtml(isCreatorRoot ? '' : (g.creator_class || ''))}"
          data-creator-division="${escapeHtml(isCreatorRoot ? '' : (g.creator_division || ''))}"
          data-creator-roll="${escapeHtml(isCreatorRoot ? '' : (g.creator_roll || ''))}"
          data-member-count="${g.member_count || 1}">
          <div class="overflow-hidden pr-2 flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center shrink-0">
              <i data-lucide="users" class="w-4 h-4"></i>
            </div>
            <div class="overflow-hidden">
              <div class="font-bold truncate text-xs">${escapeHtml(g.name)}</div>
              ${academicDetail ? `<div class="text-[10px] text-[var(--md-primary)] font-medium truncate">${escapeHtml(academicDetail)}</div>` : ''}
            </div>
          </div>
          <div class="shrink-0 text-right">
            ${isPending
              ? '<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold animate-pulse">Invite</span>'
              : `<span class="text-[10px] text-[var(--md-on-surface-variant)] font-bold tabular-nums px-2 py-0.5 rounded-full bg-white/80">${g.member_count || 1}</span>`
            }
          </div>
        </button>
      `;
    }).join('');

    initIcons();

    container.querySelectorAll('.group-item').forEach(btn => {
      btn.addEventListener('click', () => selectGroupConversation(btn.dataset));
    });

    if (openGroupId) {
      const target = Array.from(container.querySelectorAll('.group-item')).find(b => b.dataset.groupId === openGroupId);
      if (target) selectGroupConversation(target.dataset);
    }
  } catch (err) {
    container.innerHTML = `<div class="p-3 text-rose-500 text-[11px] text-center">${escapeHtml(err.message)}</div>`;
  }
}

export function selectGroupConversation(data) {
  clearReplyTarget();
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

  const isCreatorRoot = data.creatorIsRoot === 'true' || data.creatorUsername === 'admin' || data.creatorRole === 'admin';
  channelNameEl.textContent = data.name;
  const creatorAcademic = isCreatorRoot
    ? `Created by ${data.creatorName || 'Admin'} (Admin)`
    : [
        data.creatorName ? `Created by ${data.creatorName}` : '',
        data.creatorClass ? `${data.creatorClass}${data.creatorDivision ? ' (' + data.creatorDivision + ')' : ''}` : '',
        data.creatorRoll ? `Roll #${data.creatorRoll}` : ''
      ].filter(Boolean).join(' • ');

  chatSubtitleEl.textContent = creatorAcademic || 'Custom Study Group • Auto-purge 7 days';
  currentChatIcon.innerHTML = `<i data-lucide="users" class="w-4 h-4"></i>`;
  groupInfoBtn?.classList.remove('hidden');
  groupInfoBtn?.classList.add('inline-flex');
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

  document.querySelectorAll('.group-item').forEach(b => {
    const active = b.dataset.groupId === data.groupId;
    b.className = `group-item w-full px-3 py-2.5 rounded-2xl text-left flex items-center justify-between transition border ${
      active
        ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] border-transparent'
        : 'bg-transparent hover:bg-[var(--md-surface-container)] border-transparent'
    }`;
  });

  initIcons();
  loadMessages();
}

function switchGroupModalTab(tab) {
  const tabMembers = document.getElementById('tab-btn-group-members');
  const tabAdd = document.getElementById('tab-btn-group-add');
  const panelMembers = document.getElementById('panel-group-members');
  const panelAdd = document.getElementById('panel-group-add');

  if (tab === 'members') {
    tabMembers.className = 'py-1.5 rounded-full bg-white text-[var(--md-primary)] shadow-xs transition';
    tabAdd.className = 'py-1.5 rounded-full text-[var(--md-on-surface-variant)] transition flex items-center justify-center gap-1';
    panelMembers.classList.remove('hidden');
    panelAdd.classList.add('hidden');
    panelAdd.classList.remove('flex');
  } else {
    tabAdd.className = 'py-1.5 rounded-full bg-white text-[var(--md-primary)] shadow-xs transition flex items-center justify-center gap-1';
    tabMembers.className = 'py-1.5 rounded-full text-[var(--md-on-surface-variant)] transition';
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
    const isRoot = isRootUser(m);
    const role = m.user_role || (isRoot ? 'admin' : 'student');

    const sub = formatMemberSubline({ ...m, role });

    return `
      <div class="py-2 px-2.5 rounded-2xl flex items-center justify-between hover:bg-[var(--md-surface-container)] transition">
        <div class="overflow-hidden">
          <div class="font-bold text-xs truncate flex items-center gap-1.5 flex-wrap">
            ${escapeHtml(m.full_name)}
            ${isMe ? '<span class="text-[9px] text-slate-400 font-normal">(You)</span>' : ''}
            ${renderRoleBadgeHtml(role, m.teacher_type, isRoot)}
            ${isAdmin ? '<span class="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold uppercase">Group Owner</span>' : ''}
            ${isPending ? '<span class="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">Pending</span>' : ''}
          </div>
          <div class="text-[10px] text-[var(--md-primary)] font-medium truncate mt-0.5">${escapeHtml(sub)} • @${escapeHtml(m.username)}</div>
        </div>
        ${canRemove ? `
          <button class="remove-member-btn text-[10px] text-rose-600 font-bold px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 transition shrink-0"
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
    selector.innerHTML = '<p class="text-center text-slate-400 py-6 text-[11px]">No members found.</p>';
    return;
  }

  const existingMap = new Map();
  chatState.currentGroupMembers.forEach(m => existingMap.set(m.user_id, m.invite_status || 'accepted'));

  selector.innerHTML = list.slice(0, 40).map(s => {
    const isCurrentMember = existingMap.has(s.id);
    const status = existingMap.get(s.id);
    const isMe = s.id === chatState.user?.id;
    const isRoot = isRootUser(s);

    let actionButton = '';
    if (isMe) {
      actionButton = '<span class="text-[9px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">You</span>';
    } else if (isCurrentMember) {
      actionButton = status === 'accepted'
        ? '<span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">In Group</span>'
        : '<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">Invited</span>';
    } else {
      actionButton = `
        <button class="invite-classmate-btn m3-btn-tonal px-3 py-1 text-[10px] shrink-0"
          data-user-id="${escapeHtml(s.id)}" data-user-name="${escapeHtml(s.full_name)}">
          + Invite
        </button>
      `;
    }

    const sub = formatMemberSubline(s);

    return `
      <div class="py-2 px-1.5 flex items-center justify-between hover:bg-[var(--md-surface-container)] rounded-xl transition gap-2">
        <div class="overflow-hidden">
          <div class="font-bold text-[11px] truncate flex items-center gap-1">
            <span>${escapeHtml(s.full_name)}</span>
            ${renderRoleBadgeHtml(s.role, s.teacher_type, isRoot)}
          </div>
          <div class="text-[9px] text-[var(--md-primary)] font-medium truncate">${escapeHtml(sub)} • @${escapeHtml(s.username)}</div>
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
      const res = await apiRequest('/chat/groups', { method: 'POST', body: { name, description } });
      showToast('Study group created!', 'success');
      e.target.reset();
      closeCreateGroup();
      await loadGroupsList(res.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
