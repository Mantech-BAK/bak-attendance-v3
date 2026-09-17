import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import IdentifyCodeForm from '../components/IdentifyCodeForm';
import IdentifyMethodChooser from '../components/IdentifyMethodChooser';
import FaceCaptureModal from '../components/FaceCaptureModal';
import FaceRevalidationModal from '../components/FaceRevalidationModal';
import FaceRegistrationModal from '../components/FaceRegistrationModal';
import EmployeeCard from '../components/EmployeeCard';
import TabBar from '../components/TabBar';
import PunchProjectList from '../components/PunchProjectList';
import TaskAssignmentForm from '../components/TaskAssignmentForm';
import EmergencyTaskTab from '../components/EmergencyTaskTab';
import ReviewAttendanceTab from '../components/ReviewAttendanceTab';
import PunchHistoryTab from '../components/PunchHistoryTab';
import ProfileOverlay from '../components/ProfileOverlay';
import RejectReasonModal from '../components/RejectReasonModal';
import OutRemarkModal from '../components/OutRemarkModal';
import PunchPhotoUploadModal from '../components/PunchPhotoUploadModal';
import EditApprovalTaskModal from '../components/EditApprovalTaskModal';
import {
  identifyPunch,
  submitPunch,
  fetchTodayPunchStatus,
  fetchPendingApprovals,
  approvePunch,
  rejectPunch,
  fetchPendingOtApprovals,
  approveOt,
  rejectOt,
  fetchDirectReports,
  fetchPunchHistory,
  fetchMyPunchableTasks,
  fetchEmployee,
  fetchProjects,
  createTask,
} from '../api/client';

const EMPLOYEE_TABS = [
  { key: 'punch', label: 'Punch' },
  { key: 'my-tasks', label: 'Emergency Tasks' },
  { key: 'punch-history', label: 'Punch History' },
  { key: 'scan-another', label: 'Scan Another Employee' },
];

const SUPERVISOR_TABS = [
  { key: 'punch', label: 'Punch' },
  { key: 'my-tasks', label: 'Emergency Tasks' },
  { key: 'task-assignment', label: 'Create Team Task' },
  { key: 'scan-team-member', label: 'Scan Team Member' },
  { key: 'review-attendance', label: 'Review Attendance' },
  { key: 'punch-history', label: 'Punch History' },
];

export default function PunchScreen() {
  const [showIdentifyChooser, setShowIdentifyChooser] = useState(false);
  const [showIdentifyForm, setShowIdentifyForm] = useState(false);
  const [showFaceCapture, setShowFaceCapture] = useState(false);
  const [showFaceRegistration, setShowFaceRegistration] = useState(false);
  const [identifyMode, setIdentifyMode] = useState('self'); // 'self' | 'team'
  const [identifying, setIdentifying] = useState(false);
  const [identifyingTeamMember, setIdentifyingTeamMember] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [activeTab, setActiveTab] = useState('punch');
  const [selfTasks, setSelfTasks] = useState([]);
  const [selfOpenTaskId, setSelfOpenTaskId] = useState(null);
  const [selfOpenProjectCode, setSelfOpenProjectCode] = useState(null);

  const [teamMemberTarget, setTeamMemberTarget] = useState(null);
  const [teamMemberTasks, setTeamMemberTasks] = useState([]);
  const [teamOpenTaskId, setTeamOpenTaskId] = useState(null);
  const [teamOpenProjectCode, setTeamOpenProjectCode] = useState(null);

  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [processingApprovalId, setProcessingApprovalId] = useState(null);
  const [pendingOtApprovals, setPendingOtApprovals] = useState([]);
  const [loadingOt, setLoadingOt] = useState(false);
  const [processingOtId, setProcessingOtId] = useState(null);
  const [directReports, setDirectReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [punchHistory, setPunchHistory] = useState([]);
  const [loadingPunchHistory, setLoadingPunchHistory] = useState(false);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [showProfileOverlay, setShowProfileOverlay] = useState(false);
  // { type: 'punch' | 'ot', id } — one modal shared by both approval flows.
  const [rejectingItem, setRejectingItem] = useState(null);

  // Item 2 (2026-09-10) — re-validation gate shown immediately before every
  // self-punch (never for the supervisor "Scan Team Member" on-behalf
  // flow, which is unchanged). null | 'choose' | 'face' | 'code'. The
  // pending Promise's resolver lives in a ref (not state) so it survives
  // across renders without itself triggering one.
  const [revalidationStep, setRevalidationStep] = useState(null);
  const revalidationResolverRef = useRef(null);

  // Mandatory remark shown right before a CLOSING punch (self or the
  // supervisor's on-behalf close) — never for an opening punch. { subjectName }
  // or null when hidden; resolver lives in a ref for the same reason as
  // revalidationResolverRef above.
  const [outRemarkPrompt, setOutRemarkPrompt] = useState(null);
  const outRemarkResolverRef = useRef(null);

  function requestOutRemark(subjectName) {
    return new Promise((resolve) => {
      outRemarkResolverRef.current = resolve;
      setOutRemarkPrompt({ subjectName });
    });
  }

  function resolveOutRemark(value) {
    setOutRemarkPrompt(null);
    const resolve = outRemarkResolverRef.current;
    outRemarkResolverRef.current = null;
    if (resolve) resolve(value);
  }

  // Mandatory in/out task photo (2026-09-14) — added independently of the
  // punch action itself (recording a punch and uploading its photo are
  // separate actions), via "Add Photo" on a task card. refreshSetter is
  // whichever of setSelfTasks/setTeamMemberTasks that task list came from,
  // so the card's photo status updates immediately on success.
  const [photoUploadTarget, setPhotoUploadTarget] = useState(null);

  function handleAddPhoto(task, role, targetEmpId, refreshSetter) {
    const punchId = role === 'in' ? task.in_punch_id : task.out_punch_id;
    setPhotoUploadTarget({
      punchId,
      empId: targetEmpId,
      label: `Add ${role === 'in' ? 'an In' : 'an Out'} Photo for "${task.name}"`,
      refreshEmpId: targetEmpId,
      refreshSetter,
    });
  }

  function handlePhotoUploaded() {
    if (photoUploadTarget) {
      refreshTasksFor(photoUploadTarget.refreshEmpId, photoUploadTarget.refreshSetter);
    }
    setPhotoUploadTarget(null);
  }

  // is_supervisor is an admin-set flag, decoupled from designation/job
  // title (real designations are things like "Operations Manager", never
  // literally "Supervisor") — see backend/src/services/backofficeAuth.js.
  const isSupervisor = employee?.is_supervisor === true;
  const tabs = isSupervisor ? SUPERVISOR_TABS : EMPLOYEE_TABS;

  function resetToIdle() {
    setEmployee(null);
    setActiveTab('punch');
    setSelfTasks([]);
    setSelfOpenTaskId(null);
    setSelfOpenProjectCode(null);
    setTeamMemberTarget(null);
    setTeamMemberTasks([]);
    setTeamOpenTaskId(null);
    setTeamOpenProjectCode(null);
    setPendingApprovals([]);
    setPendingOtApprovals([]);
    setDirectReports([]);
    setProjects([]);
    setPunchHistory([]);
    setProfile(null);
    setShowProfileOverlay(false);
    // Abandon any in-flight re-validation prompt rather than leaving a
    // dangling resolver — its caller (handlePunchSelf) will just never
    // continue, which is fine since the whole screen is resetting anyway.
    setRevalidationStep(null);
    revalidationResolverRef.current = null;
    setOutRemarkPrompt(null);
    outRemarkResolverRef.current = null;
    setPhotoUploadTarget(null);
    setEditingApprovalPunch(null);
  }

  const loadSupervisorData = useCallback(async (supervisorEmpId) => {
    setLoadingApprovals(true);
    setLoadingOt(true);
    try {
      const [approvals, otApprovals, reports, projectList] = await Promise.all([
        fetchPendingApprovals(supervisorEmpId),
        fetchPendingOtApprovals(supervisorEmpId),
        fetchDirectReports(supervisorEmpId),
        fetchProjects(),
      ]);
      setPendingApprovals(approvals || []);
      setPendingOtApprovals(otApprovals || []);
      setDirectReports(reports || []);
      setProjects(projectList || []);
    } catch (err) {
      Alert.alert('Could not load team data', err.message);
    } finally {
      setLoadingApprovals(false);
      setLoadingOt(false);
    }
  }, []);

  // Shared by both roles (item 8/9) — the backend already scopes rows
  // correctly per viewer (self + team for a supervisor, self only for a
  // regular employee), so there's nothing role-specific to do here.
  const loadPunchHistory = useCallback(async (empId) => {
    setLoadingPunchHistory(true);
    try {
      setPunchHistory((await fetchPunchHistory(empId)) || []);
    } catch (err) {
      Alert.alert('Could not load punch history', err.message);
    } finally {
      setLoadingPunchHistory(false);
    }
  }, []);

  // Refreshes just the punch-selection task list for whichever employee is
  // currently being punched for (self or, on the supervisor's on-behalf
  // flow, the scanned team member) — used to pick up a task that was just
  // created or just completed without waiting for a full re-identify
  // (item 1's fix: employee.tasks/teamMemberTarget.tasks used to be a
  // snapshot taken once at identify/scan time and never refreshed again).
  const refreshTasksFor = useCallback(async (empId, setter) => {
    try {
      setter((await fetchMyPunchableTasks(empId)) || []);
    } catch {
      // Best-effort — the stale list just stays stale until the next
      // successful refresh; not worth surfacing an alert for a background
      // refresh the user didn't explicitly ask for.
    }
  }, []);

  const loadProfile = useCallback(async (empId) => {
    setLoadingProfile(true);
    try {
      const result = await fetchEmployee(empId);
      setProfile(result);
    } catch (err) {
      Alert.alert('Could not load profile', err.message);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  // Kept in refs so the AppState listener always calls the latest version
  // without needing to resubscribe on every render.
  const loadSupervisorDataRef = useRef(loadSupervisorData);
  loadSupervisorDataRef.current = loadSupervisorData;
  const loadPunchHistoryRef = useRef(loadPunchHistory);
  loadPunchHistoryRef.current = loadPunchHistory;
  const refreshTasksForRef = useRef(refreshTasksFor);
  refreshTasksForRef.current = refreshTasksFor;

  // There's no multi-screen navigator here (single always-mounted screen),
  // so AppState is the equivalent of a navigation focus listener: refresh
  // whenever the app comes back to the foreground while someone is
  // identified, instead of only ever fetching once at identify-time (item
  // 1's fix, applied here too — not just supervisor data, every identified
  // employee's own punch-selection list and punch history refresh now).
  const identifiedRef = useRef({ isSupervisor: false, empId: null });
  identifiedRef.current = { isSupervisor, empId: employee?.emp_id ?? null };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const { isSupervisor: sup, empId } = identifiedRef.current;
      if (nextState === 'active' && empId) {
        refreshTasksForRef.current(empId, setSelfTasks);
        loadPunchHistoryRef.current(empId);
        if (sup) {
          loadSupervisorDataRef.current(empId);
        }
      }
    });
    return () => subscription.remove();
  }, []);

  // Summary popup, shown every time the supervisor switches to this tab —
  // not just once per login session — using whatever counts are currently
  // loaded (item 10). Deliberately keyed only on activeTab: re-approving/
  // rejecting items while already on the tab must not re-trigger it, only
  // actually (re-)opening the tab should.
  useEffect(() => {
    if (activeTab === 'review-attendance') {
      Alert.alert(
        'Team Attendance Summary',
        `${pendingApprovals.length} pending punch approval${pendingApprovals.length === 1 ? '' : 's'}, ` +
          `${pendingOtApprovals.length} pending OT approval${pendingOtApprovals.length === 1 ? '' : 's'}.`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  async function applySelfIdentifyResult(result) {
    setEmployee(result);
    setSelfTasks(result.tasks || []);
    setActiveTab('punch');
    setTeamMemberTarget(null);
    setTeamMemberTasks([]);
    setTeamOpenTaskId(null);
    setTeamOpenProjectCode(null);

    const status = await fetchTodayPunchStatus(result.emp_id);
    setSelfOpenTaskId(status.open_task_id);
    setSelfOpenProjectCode(status.open_project_code);

    loadProfile(result.emp_id);
    loadPunchHistory(result.emp_id);
    if (result.is_supervisor) {
      loadSupervisorData(result.emp_id);
    } else {
      // Needed for the Emergency Tasks tab's self-service create form —
      // every employee can potentially use it, not just supervisors.
      // loadSupervisorData above already covers this for a supervisor.
      fetchProjects().then(setProjects).catch(() => {});
    }
  }

  async function applyTeamMemberResult(result) {
    const isDirectReport = directReports.some((r) => r.emp_id === result.emp_id);
    if (!isDirectReport) {
      Alert.alert('Not in your team.', `${result.name} does not report to you.`);
      return;
    }
    setTeamMemberTarget(result);
    setTeamMemberTasks(result.tasks || []);
    const status = await fetchTodayPunchStatus(result.emp_id);
    setTeamOpenTaskId(status.open_task_id);
    setTeamOpenProjectCode(status.open_project_code);
  }

  async function handleIdentifySubmit({ empId, loginCode }) {
    if (identifyMode === 'team') {
      setIdentifyingTeamMember(true);
      try {
        const result = await identifyPunch(empId, loginCode);
        await applyTeamMemberResult(result);
        setShowIdentifyForm(false);
      } finally {
        setIdentifyingTeamMember(false);
      }
      return;
    }

    setIdentifying(true);
    try {
      const result = await identifyPunch(empId, loginCode);
      await applySelfIdentifyResult(result);
      setShowIdentifyForm(false);
    } finally {
      setIdentifying(false);
    }
  }

  function handleScanTeamMember() {
    setIdentifyMode('team');
    setShowIdentifyChooser(true);
  }

  function handleScanSelf() {
    setIdentifyMode('self');
    setShowIdentifyChooser(true);
  }

  function handleChooseCodeIdentify() {
    setShowIdentifyChooser(false);
    setShowIdentifyForm(true);
  }

  function handleChooseFaceIdentify() {
    setShowIdentifyChooser(false);
    setShowFaceCapture(true);
  }

  async function handleFaceIdentified(result) {
    setShowFaceCapture(false);
    if (identifyMode === 'team') {
      await applyTeamMemberResult(result);
    } else {
      await applySelfIdentifyResult(result);
    }
  }

  // Resolves once the employee completes (or cancels) the re-validation
  // prompt — the promise is how handlePunchSelf below can "await" a UI
  // interaction. Resolves { faceEmbedding } or { loginCode } on success,
  // null on cancel at any step.
  function requestSelfRevalidation() {
    return new Promise((resolve) => {
      revalidationResolverRef.current = resolve;
      setRevalidationStep('choose');
    });
  }

  function resolveRevalidation(value) {
    setRevalidationStep(null);
    const resolve = revalidationResolverRef.current;
    revalidationResolverRef.current = null;
    if (resolve) resolve(value);
  }

  // Re-verifies the code is actually correct for this employee before
  // resolving, reusing the same identify endpoint the initial identify flow
  // already relies on — a wrong code surfaces inline in this same form for
  // retry (IdentifyCodeForm's own try/catch), never as a generic "Punch
  // failed" alert after the fact.
  async function handleRevalidationCodeSubmit({ loginCode }) {
    await identifyPunch(employee.emp_id, loginCode);
    resolveRevalidation({ loginCode });
  }

  async function handlePunchSelf(task, { lat, lng }) {
    // Every self-punch — an employee or a supervisor punching their OWN
    // tasks — requires a completely fresh re-validation right here, every
    // time, even seconds after the last one succeeded. Cancelling at any
    // point silently abandons this specific punch attempt (no error alert,
    // no punch recorded) rather than falling through.
    const revalidation = await requestSelfRevalidation();
    if (!revalidation) return;

    const wasOpen = task.id ? task.id === selfOpenTaskId : task.project_code === selfOpenProjectCode;

    // Mandatory on the closing punch only — cancelling abandons this punch
    // attempt the same way declining re-validation does, above.
    let outRemark;
    if (wasOpen) {
      outRemark = await requestOutRemark();
      if (!outRemark) return;
    }

    await submitPunch({
      empId: employee.emp_id,
      taskId: task.id,
      projectCode: task.id ? undefined : task.project_code,
      lat,
      lng,
      outRemark,
      revalidationFaceEmbedding: revalidation.faceEmbedding,
      revalidationLoginCode: revalidation.loginCode,
    });

    const status = await fetchTodayPunchStatus(employee.emp_id);
    setSelfOpenTaskId(status.open_task_id);
    setSelfOpenProjectCode(status.open_project_code);
    // Picks up the task just going Pending->Completed (2nd punch) promptly,
    // instead of it only showing Closed after a full logout/re-identify.
    refreshTasksFor(employee.emp_id, setSelfTasks);
    loadPunchHistory(employee.emp_id);

    Alert.alert('Punch recorded', wasOpen ? `${task.name} closed.` : `${task.name} is now open.`);
  }

  async function handlePunchTeamMember(task, { lat, lng }) {
    const wasOpen = task.id ? task.id === teamOpenTaskId : task.project_code === teamOpenProjectCode;

    // Mandatory on the closing punch only, same as self-punch above — the
    // supervisor is the one typing it, on the team member's behalf.
    let outRemark;
    if (wasOpen) {
      outRemark = await requestOutRemark(teamMemberTarget.name);
      if (!outRemark) return;
    }

    await submitPunch({
      empId: teamMemberTarget.emp_id,
      taskId: task.id,
      projectCode: task.id ? undefined : task.project_code,
      lat,
      lng,
      outRemark,
      enteredBy: employee.emp_id,
    });

    const status = await fetchTodayPunchStatus(teamMemberTarget.emp_id);
    setTeamOpenTaskId(status.open_task_id);
    setTeamOpenProjectCode(status.open_project_code);
    refreshTasksFor(teamMemberTarget.emp_id, setTeamMemberTasks);
    loadPunchHistory(employee.emp_id);

    Alert.alert(
      'Punch recorded',
      wasOpen
        ? `${teamMemberTarget.name}'s ${task.name} was closed.`
        : `${teamMemberTarget.name}'s ${task.name} is now open.`
    );
  }

  function handleScanDifferentTeamMember() {
    setTeamMemberTarget(null);
    setTeamOpenProjectCode(null);
  }

  // Review Attendance's Edit action (2026-09-14) — reassigns a pending
  // team punch's task/project before the supervisor decides to approve or
  // reject it. Refetches the whole pending list on success rather than
  // patching the one item in place — simpler than reconstructing
  // employee_name/task_display_id/project_name client-side, and this list
  // is never long enough for a full refetch to matter.
  const [editingApprovalPunch, setEditingApprovalPunch] = useState(null);

  function handleEditApprovalSaved() {
    setEditingApprovalPunch(null);
    loadSupervisorData(employee.emp_id);
  }

  async function handleApprove(punchId, extraOtMinutes) {
    setProcessingApprovalId(punchId);
    try {
      await approvePunch(punchId, employee.emp_id, extraOtMinutes);
      setPendingApprovals((prev) => prev.filter((p) => p.id !== punchId));
    } catch (err) {
      if (err.status === 403) {
        Alert.alert('No longer assigned to you', 'This punch is no longer assigned to you. Refreshing your list…');
        loadSupervisorData(employee.emp_id);
      } else {
        Alert.alert('Approve failed', err.message);
      }
    } finally {
      setProcessingApprovalId(null);
    }
  }

  async function handleApproveOt(otApprovalId) {
    setProcessingOtId(otApprovalId);
    try {
      await approveOt(otApprovalId, employee.emp_id);
      setPendingOtApprovals((prev) => prev.filter((o) => o.id !== otApprovalId));
    } catch (err) {
      if (err.status === 403) {
        Alert.alert('No longer assigned to you', 'This employee is no longer assigned to you. Refreshing your list…');
        loadSupervisorData(employee.emp_id);
      } else {
        Alert.alert('Approve failed', err.message);
      }
    } finally {
      setProcessingOtId(null);
    }
  }

  async function handleRejectSubmit(reason) {
    const { type, id } = rejectingItem;
    try {
      if (type === 'ot') {
        await rejectOt(id, employee.emp_id, reason);
        setPendingOtApprovals((prev) => prev.filter((o) => o.id !== id));
      } else {
        await rejectPunch(id, employee.emp_id, reason);
        setPendingApprovals((prev) => prev.filter((p) => p.id !== id));
      }
      setRejectingItem(null);
    } catch (err) {
      if (err.status === 403) {
        setRejectingItem(null);
        const message = type === 'ot'
          ? 'This employee is no longer assigned to you. Refreshing your list…'
          : 'This punch is no longer assigned to you. Refreshing your list…';
        Alert.alert('No longer assigned to you', message);
        loadSupervisorData(employee.emp_id);
        return;
      }
      // Any other error (validation, network, already-resolved conflict) is
      // shown inline by RejectReasonModal, which keeps the modal open so
      // the supervisor can retry.
      throw err;
    }
  }

  async function handleCreateTask({ assignedEmpId, projectCode, priority, description, locationSite, isOutdoor, shiftType }) {
    await createTask({ assignedEmpId, projectCode, priority, description, locationSite, isOutdoor, shiftType, createdBy: employee.emp_id });
    // If the assignee is the team member currently scanned for on-behalf
    // punching, refresh their list so the new task shows up immediately
    // instead of only after a fresh scan (item 1's fix, extended to this
    // path too).
    if (teamMemberTarget?.emp_id === assignedEmpId) {
      refreshTasksFor(assignedEmpId, setTeamMemberTasks);
    }
  }

  // Self-service: assignedEmpId is always this same employee (enforced
  // again server-side regardless), source 'employee_self' is what the
  // backend actually gates on the Emergency Time Allowance window.
  async function handleCreateSelfTask({ assignedEmpId, projectCode, priority, description, locationSite, isOutdoor, shiftType }) {
    await createTask({
      assignedEmpId,
      projectCode,
      priority,
      description,
      locationSite,
      isOutdoor,
      shiftType,
      createdBy: employee.emp_id,
      source: 'employee_self',
    });
    // The whole point of item 1's fix — the new emergency task must appear
    // in the normal Punch tab right away, not after a logout/re-identify.
    refreshTasksFor(employee.emp_id, setSelfTasks);
  }

  function renderTabContent() {
    if (activeTab === 'punch') {
      return (
        <PunchProjectList
          tasks={selfTasks}
          openTaskId={selfOpenTaskId}
          openProjectCode={selfOpenProjectCode}
          onPunch={handlePunchSelf}
          onAddPhoto={(task, role) => handleAddPhoto(task, role, employee.emp_id, setSelfTasks)}
        />
      );
    }

    if (activeTab === 'my-tasks') {
      return (
        <EmergencyTaskTab empId={employee.emp_id} projects={projects} onTaskCreated={handleCreateSelfTask} />
      );
    }

    if (activeTab === 'punch-history') {
      return (
        <PunchHistoryTab
          history={punchHistory}
          loading={loadingPunchHistory}
          viewerEmpId={employee.emp_id}
          heading={isSupervisor ? 'Team Punch History' : 'Punch History'}
          showLegend={isSupervisor}
        />
      );
    }

    if (activeTab === 'scan-another') {
      return (
        <View style={styles.scanAnotherContainer}>
          <Ionicons name="people-circle-outline" size={48} color="#93c5fd" style={styles.idleIcon} />
          <Text style={styles.scanAnotherHint}>Hand the device to the next person.</Text>
          <TouchableOpacity style={styles.scanButton} onPress={handleScanSelf}>
            <Ionicons name="finger-print-outline" size={18} color="#fff" />
            <Text style={styles.scanButtonText}>Identify</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeTab === 'task-assignment') {
      return (
        <TaskAssignmentForm
          directReports={directReports}
          projects={projects}
          onSubmit={handleCreateTask}
          heading="Create a Team Task"
        />
      );
    }

    if (activeTab === 'scan-team-member') {
      if (identifyingTeamMember) {
        return (
          <View style={styles.teamIdentifyingRow}>
            <ActivityIndicator size="small" color="#2563eb" />
            <Text style={styles.teamIdentifyingText}>Identifying team member…</Text>
          </View>
        );
      }

      if (!teamMemberTarget) {
        return (
          <View style={styles.scanAnotherContainer}>
            <Ionicons name="people-outline" size={48} color="#93c5fd" style={styles.idleIcon} />
            <TouchableOpacity style={styles.scanButton} onPress={handleScanTeamMember}>
              <Ionicons name="finger-print-outline" size={18} color="#fff" />
              <Text style={styles.scanButtonText}>Identify Team Member</Text>
            </TouchableOpacity>
          </View>
        );
      }

      return (
        <View style={styles.teamMemberContainer}>
          <View style={styles.onBehalfBannerRow}>
            <Ionicons name="swap-horizontal-outline" size={14} color="#6b7280" />
            <Text style={styles.onBehalfBanner}>Punching on behalf of {teamMemberTarget.name}</Text>
          </View>
          <EmployeeCard employee={teamMemberTarget} />
          <PunchProjectList
            tasks={teamMemberTasks}
            openTaskId={teamOpenTaskId}
            openProjectCode={teamOpenProjectCode}
            onPunch={handlePunchTeamMember}
            onAddPhoto={(task, role) => handleAddPhoto(task, role, teamMemberTarget.emp_id, setTeamMemberTasks)}
          />
          <TouchableOpacity style={styles.resetButton} onPress={handleScanDifferentTeamMember}>
            <Ionicons name="refresh-outline" size={16} color="#2563eb" />
            <Text style={styles.resetButtonText}>Scan a different team member</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeTab === 'review-attendance') {
      return (
        <ReviewAttendanceTab
          pendingApprovals={pendingApprovals}
          loadingApprovals={loadingApprovals}
          onApprove={handleApprove}
          onReject={(id) => setRejectingItem({ type: 'punch', id })}
          onEdit={setEditingApprovalPunch}
          processingId={processingApprovalId}
          pendingOtApprovals={pendingOtApprovals}
          loadingOt={loadingOt}
          onApproveOt={handleApproveOt}
          onRejectOt={(id) => setRejectingItem({ type: 'ot', id })}
          processingOtId={processingOtId}
        />
      );
    }

    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={[styles.headerRow, { justifyContent: employee ? 'space-between' : 'center' }]}>
          <View style={styles.headerLeft}>
            {employee && (
              <TouchableOpacity
                style={styles.profileIconButton}
                onPress={() => setShowProfileOverlay(true)}
                accessibilityLabel="My Profile"
              >
                <Ionicons name="person-circle" size={26} color="#2563eb" />
              </TouchableOpacity>
            )}
            <Text style={[styles.title, employee && styles.titleWithLogout]}>BAK Manpower Management</Text>
          </View>
          {employee && (
            <TouchableOpacity style={styles.topLogoutButton} onPress={resetToIdle}>
              <Ionicons name="log-out-outline" size={16} color="#dc2626" />
              <Text style={styles.topLogoutText}>Log out</Text>
            </TouchableOpacity>
          )}
        </View>

        {!employee && !identifying && (
          <View style={styles.idleContainer}>
            <Ionicons name="finger-print" size={64} color="#2563eb" style={styles.idleIcon} />
            <Text style={styles.subtitle}>Tap Punch to identify yourself with Face ID or your code</Text>
            <TouchableOpacity style={styles.punchButton} onPress={handleScanSelf}>
              <Ionicons name="finger-print-outline" size={20} color="#fff" />
              <Text style={styles.punchButtonText}>Punch</Text>
            </TouchableOpacity>
          </View>
        )}

        {identifying && (
          <View style={styles.idleContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.subtitle}>Identifying…</Text>
          </View>
        )}

        {employee && (
          <View style={styles.identifiedContainer}>
            <EmployeeCard employee={employee} />
            <TabBar tabs={tabs} activeTab={activeTab} onSelectTab={setActiveTab} />
            {renderTabContent()}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      <IdentifyMethodChooser
        visible={showIdentifyChooser}
        onChooseFace={handleChooseFaceIdentify}
        onChooseCode={handleChooseCodeIdentify}
        onCancel={() => setShowIdentifyChooser(false)}
      />

      <IdentifyCodeForm
        visible={showIdentifyForm}
        onSubmit={handleIdentifySubmit}
        onCancel={() => setShowIdentifyForm(false)}
        title={identifyMode === 'team' ? "Enter Team Member's Code" : 'Enter Your Code'}
        directReports={identifyMode === 'team' ? directReports : undefined}
      />

      <FaceCaptureModal
        visible={showFaceCapture}
        onIdentified={handleFaceIdentified}
        onCancel={() => setShowFaceCapture(false)}
      />

      <IdentifyMethodChooser
        visible={revalidationStep === 'choose'}
        heading="Confirm it's you before punching"
        onChooseFace={() => setRevalidationStep('face')}
        onChooseCode={() => setRevalidationStep('code')}
        onCancel={() => resolveRevalidation(null)}
      />

      <FaceRevalidationModal
        visible={revalidationStep === 'face'}
        empId={employee?.emp_id}
        onVerified={(embedding) => resolveRevalidation({ faceEmbedding: embedding })}
        onCancel={() => resolveRevalidation(null)}
      />

      <IdentifyCodeForm
        visible={revalidationStep === 'code'}
        fixedEmpId={employee?.emp_id}
        onSubmit={handleRevalidationCodeSubmit}
        onCancel={() => resolveRevalidation(null)}
        title="Confirm It's You"
      />

      <OutRemarkModal
        visible={outRemarkPrompt !== null}
        subjectName={outRemarkPrompt?.subjectName}
        onSubmit={(remark) => resolveOutRemark(remark)}
        onCancel={() => resolveOutRemark(null)}
      />

      <PunchPhotoUploadModal
        visible={photoUploadTarget !== null}
        punchId={photoUploadTarget?.punchId}
        empId={photoUploadTarget?.empId}
        label={photoUploadTarget?.label}
        onUploaded={handlePhotoUploaded}
        onCancel={() => setPhotoUploadTarget(null)}
      />

      <EditApprovalTaskModal
        visible={editingApprovalPunch !== null}
        punch={editingApprovalPunch}
        supervisorEmpId={employee?.emp_id}
        onSaved={handleEditApprovalSaved}
        onCancel={() => setEditingApprovalPunch(null)}
      />

      <FaceRegistrationModal
        visible={showFaceRegistration}
        empId={employee?.emp_id}
        onComplete={() => {
          setShowFaceRegistration(false);
          loadProfile(employee.emp_id);
        }}
        onCancel={() => setShowFaceRegistration(false)}
      />

      <ProfileOverlay
        visible={showProfileOverlay}
        profile={profile}
        loading={loadingProfile}
        onClose={() => setShowProfileOverlay(false)}
        onRegisterFace={() => {
          setShowProfileOverlay(false);
          setShowFaceRegistration(true);
        }}
      />

      <RejectReasonModal
        visible={rejectingItem != null}
        onSubmit={handleRejectSubmit}
        onClose={() => setRejectingItem(null)}
        title={rejectingItem?.type === 'ot' ? 'Reject Overtime' : 'Reject Punch'}
        placeholder={
          rejectingItem?.type === 'ot'
            ? 'Why is this overtime being rejected?'
            : 'Why is this punch being rejected?'
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f3f4f6' },
  keyboardAvoider: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center', padding: 20 },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 24,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827' },
  titleWithLogout: { fontSize: 20 },
  profileIconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topLogoutButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10 },
  topLogoutText: { color: '#dc2626', fontSize: 14, fontWeight: '600' },
  idleContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  idleIcon: { marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#6b7280', marginBottom: 24, marginTop: 12, textAlign: 'center' },
  punchButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#2563eb',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#2563eb',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  punchButtonText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  identifiedContainer: { width: '100%' },
  onBehalfBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
  },
  onBehalfBanner: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
  },
  scanAnotherContainer: { alignItems: 'center', paddingVertical: 24 },
  scanAnotherHint: { fontSize: 14, color: '#6b7280', marginBottom: 20, textAlign: 'center' },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  scanButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  teamMemberContainer: { width: '100%' },
  teamIdentifyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
  },
  teamIdentifyingText: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
  resetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20, paddingVertical: 10 },
  resetButtonText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
});
