/**
 * Shared Teacher Permissions, Class/Subject Scope & Profile Formatter Utilities
 * Eliminates duplicated scope checks across announcements, exams, chat, admin, and teacher routes.
 */

export function parseStringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return [...new Set(parsed.map(v => String(v || '').trim()).filter(Boolean))];
        }
      } catch { /* fallback to comma split */ }
    }
    return [...new Set(trimmed.split(',').map(v => v.trim()).filter(Boolean))];
  }
  return [];
}

export function normalizeClassChannel(className) {
  if (!className) return '';
  return `class_${String(className).trim().toLowerCase().replace(/\s+/g, '_')}`;
}

export function getTeacherAllowedClasses(user) {
  const classes = new Set(parseStringList(user?.assignedClasses || user?.assigned_classes));
  if (user?.teacherType === 'class' || user?.teacher_type === 'class') {
    const primary = (user.className || user.class_name || '').trim();
    if (primary && primary !== 'Faculty' && primary !== 'All Classes') {
      classes.add(primary);
    }
  }
  return Array.from(classes);
}

export function canTeacherManageClass(user, targetClass) {
  if (!user || user.role !== 'teacher') return false;
  if (!targetClass) return false;
  const cleanTarget = String(targetClass).trim();
  if (!cleanTarget || cleanTarget.toLowerCase() === 'all' || cleanTarget.toLowerCase() === 'all classes') {
    return false;
  }
  return getTeacherAllowedClasses(user).includes(cleanTarget);
}

export function isClassTeacherForStudent(teacher, studentClass, studentDivision = '') {
  if (!teacher || teacher.role !== 'teacher') return false;
  const tType = teacher.teacherType || teacher.teacher_type;
  if (tType !== 'class') return false;

  const teacherClass = (teacher.className || teacher.class_name || '').trim();
  if (!teacherClass || teacherClass !== String(studentClass || '').trim()) {
    return false;
  }

  const teacherDiv = (teacher.division || '').trim().toUpperCase();
  if (teacherDiv && teacherDiv !== 'ALL' && teacherDiv !== '-' && teacherDiv !== 'NA') {
    return String(studentDivision || '').trim().toUpperCase() === teacherDiv;
  }
  return true;
}

export function canTeacherModerateChannel(user, channel) {
  if (!user || user.role !== 'teacher' || !channel) return false;
  if (channel === 'academics') return true;
  if (!channel.startsWith('class_')) return false;
  const allowedChannels = getTeacherAllowedClasses(user).map(normalizeClassChannel);
  return allowedChannels.includes(channel);
}

export function formatUserProfile(row) {
  if (!row) return null;
  const isRootAdmin = row.is_root_admin === 1 || row.username === 'admin';
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    className: row.class_name,
    division: row.division || '',
    rollNumber: row.roll_number || '',
    email: row.email || null,
    role: row.role,
    accountStatus: row.account_status,
    rejectionReason: row.rejection_reason || null,
    teacherType: row.teacher_type || null,
    assignedClasses: parseStringList(row.assigned_classes),
    assignedSubjects: parseStringList(row.assigned_subjects),
    allowStudentDms: row.allow_student_dms !== 0,
    isRootAdmin,
  };
}
