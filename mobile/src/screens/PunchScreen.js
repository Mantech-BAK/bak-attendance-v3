import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import IdentifyCodeForm from '../components/IdentifyCodeForm';
import EmployeeCard from '../components/EmployeeCard';
import TabBar from '../components/TabBar';
import PunchProjectList from '../components/PunchProjectList';
import TaskAssignmentForm from '../components/TaskAssignmentForm';
import ReviewAttendanceTab from '../components/ReviewAttendanceTab';
import TeamPunchHistoryTab from '../components/TeamPunchHistoryTab';
import ProfileOverlay from '../components/ProfileOverlay';
import RejectReasonModal from '../components/RejectReasonModal';
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
  fetchTeamPunchHistory,
  fetchEmployee,
  fetchProjects,
  createTask,
} from '../api/client';
import { SUPERVISOR_DESIGNATION } from '../config';

const EMPLOYEE_TABS = [
  { key: 'punch', label: 'Punch' },
  { key: 'scan-another', label: 'Scan Another Employee' },
];

const SUPERVISOR_TABS = [
  { key: 'punch', label: 'Punch' },
  { key: 'task-assignment', label: 'Task Assignment' },
  { key: 'scan-team-member', label: 'Scan Team Member' },
  { key: 'review-attendance', label: 'Review Attendance' },
  { key: 'punch-history', label: 'Punch History' },
];

export default function PunchScreen() {
  const [showIdentifyForm, setShowIdentifyForm] = useState(false);
  const [identifyMode, setIdentifyMode] = useState('self'); // 'self' | 'team'
  const [identifying, setIdentifying] = useState(false);
  const [identifyingTeamMember, setIdentifyingTeamMember] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [activeTab, setActiveTab] = useState('punch');
  const [selfOpenTaskId, setSelfOpenTaskId] = useState(null);
  const [selfOpenProjectCode, setSelfOpenProjectCode] = useState(null);

  const [teamMemberTarget, setTeamMemberTarget] = useState(null);
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
  const [teamHistory, setTeamHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [showProfileOverlay, setShowProfileOverlay] = useState(false);
  // { type: 'punch' | 'ot', id } — one modal shared by both approval flows.
  const [rejectingItem, setRejectingItem] = useState(null);

  const isSupervisor = employee?.designation === SUPERVISOR_DESIGNATION;
  const tabs = isSupervisor ? SUPERVISOR_TABS : EMPLOYEE_TABS;

  function resetToIdle() {
    setEmployee(null);
    setActiveTab('punch');
    setSelfOpenTaskId(null);
    setSelfOpenProjectCode(null);
    setTeamMemberTarget(null);
    setTeamOpenTaskId(null);
    setTeamOpenProjectCode(null);
    setPendingApprovals([]);
    setPendingOtApprovals([]);
    setDirectReports([]);
    setProjects([]);
    setTeamHistory([]);
    setProfile(null);
    setShowProfileOverlay(false);
  }

  const loadSupervisorData = useCallback(async (supervisorEmpId) => {
    setLoadingApprovals(true);
    setLoadingOt(true);
    setLoadingHistory(true);
    try {
      const [approvals, otApprovals, reports, projectList, history] = await Promise.all([
        fetchPendingApprovals(supervisorEmpId),
        fetchPendingOtApprovals(supervisorEmpId),
        fetchDirectReports(supervisorEmpId),
        fetchProjects(),
        fetchTeamPunchHistory(supervisorEmpId),
      ]);
      setPendingApprovals(approvals || []);
      setPendingOtApprovals(otApprovals || []);
      setDirectReports(reports || []);
      setProjects(projectList || []);
      setTeamHistory(history || []);
    } catch (err) {
      Alert.alert('Could not load team data', err.message);
    } finally {
      setLoadingApprovals(false);
      setLoadingOt(false);
      setLoadingHistory(false);
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

  // Kept in a ref so the AppState listener always calls the latest version
  // without needing to resubscribe on every render.
  const loadSupervisorDataRef = useRef(loadSupervisorData);
  loadSupervisorDataRef.current = loadSupervisorData;

  // There's no multi-screen navigator here (single always-mounted screen),
  // so AppState is the equivalent of a navigation focus listener: refresh
  // the pending-approvals list whenever the app comes back to the
  // foreground while a supervisor is identified, instead of only ever
  // fetching once at identify-time.
  const supervisorRef = useRef({ isSupervisor: false, empId: null });
  supervisorRef.current = { isSupervisor, empId: employee?.emp_id ?? null };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && supervisorRef.current.isSupervisor) {
        loadSupervisorDataRef.current(supervisorRef.current.empId);
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
    setActiveTab('punch');
    setTeamMemberTarget(null);
    setTeamOpenTaskId(null);
    setTeamOpenProjectCode(null);

    const status = await fetchTodayPunchStatus(result.emp_id);
    setSelfOpenTaskId(status.open_task_id);
    setSelfOpenProjectCode(status.open_project_code);

    loadProfile(result.emp_id);
    if (result.designation === SUPERVISOR_DESIGNATION) {
      loadSupervisorData(result.emp_id);
    }
  }

  async function applyTeamMemberResult(result) {
    const isDirectReport = directReports.some((r) => r.emp_id === result.emp_id);
    if (!isDirectReport) {
      Alert.alert('Not in your team.', `${result.name} does not report to you.`);
      return;
    }
    setTeamMemberTarget(result);
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
    setShowIdentifyForm(true);
  }

  function handleScanSelf() {
    setIdentifyMode('self');
    setShowIdentifyForm(true);
  }

  async function handlePunchSelf(task, { lat, lng }) {
    const wasOpen = task.id ? task.id === selfOpenTaskId : task.project_code === selfOpenProjectCode;
    await submitPunch({ empId: employee.emp_id, taskId: task.id, projectCode: task.id ? undefined : task.project_code, lat, lng });

    const status = await fetchTodayPunchStatus(employee.emp_id);
    setSelfOpenTaskId(status.open_task_id);
    setSelfOpenProjectCode(status.open_project_code);

    Alert.alert('Punch recorded', wasOpen ? `${task.name} closed.` : `${task.name} is now open.`);
  }

  async function handlePunchTeamMember(task, { lat, lng }) {
    const wasOpen = task.id ? task.id === teamOpenTaskId : task.project_code === teamOpenProjectCode;
    await submitPunch({
      empId: teamMemberTarget.emp_id,
      taskId: task.id,
      projectCode: task.id ? undefined : task.project_code,
      lat,
      lng,
      enteredBy: employee.emp_id,
    });

    const status = await fetchTodayPunchStatus(teamMemberTarget.emp_id);
    setTeamOpenTaskId(status.open_task_id);
    setTeamOpenProjectCode(status.open_project_code);

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

  async function handleApprove(punchId) {
    setProcessingApprovalId(punchId);
    try {
      await approvePunch(punchId, employee.emp_id);
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

  async function handleCreateTask({ assignedEmpId, projectCode, priority, description, locationSite }) {
    await createTask({ assignedEmpId, projectCode, priority, description, locationSite, createdBy: employee.emp_id });
  }

  function renderTabContent() {
    if (activeTab === 'punch') {
      return (
        <PunchProjectList
          tasks={employee.tasks}
          openTaskId={selfOpenTaskId}
          openProjectCode={selfOpenProjectCode}
          onPunch={handlePunchSelf}
        />
      );
    }

    if (activeTab === 'scan-another') {
      return (
        <View style={styles.scanAnotherContainer}>
          <Text style={styles.scanAnotherHint}>Hand the device to the next person.</Text>
          <TouchableOpacity style={styles.scanButton} onPress={handleScanSelf}>
            <Text style={styles.scanButtonText}>Enter Code</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeTab === 'task-assignment') {
      return (
        <TaskAssignmentForm directReports={directReports} projects={projects} onSubmit={handleCreateTask} />
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
            <TouchableOpacity style={styles.scanButton} onPress={handleScanTeamMember}>
              <Text style={styles.scanButtonText}>Enter Team Member Code</Text>
            </TouchableOpacity>
          </View>
        );
      }

      return (
        <View style={styles.teamMemberContainer}>
          <Text style={styles.onBehalfBanner}>Punching on behalf of {teamMemberTarget.name}</Text>
          <EmployeeCard employee={teamMemberTarget} />
          <PunchProjectList
            tasks={teamMemberTarget.tasks}
            openTaskId={teamOpenTaskId}
            openProjectCode={teamOpenProjectCode}
            onPunch={handlePunchTeamMember}
          />
          <TouchableOpacity style={styles.resetButton} onPress={handleScanDifferentTeamMember}>
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
          processingId={processingApprovalId}
          pendingOtApprovals={pendingOtApprovals}
          loadingOt={loadingOt}
          onApproveOt={handleApproveOt}
          onRejectOt={(id) => setRejectingItem({ type: 'ot', id })}
          processingOtId={processingOtId}
        />
      );
    }

    if (activeTab === 'punch-history') {
      return <TeamPunchHistoryTab history={teamHistory} loading={loadingHistory} />;
    }

    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.headerRow, { justifyContent: employee ? 'space-between' : 'center' }]}>
          <View style={styles.headerLeft}>
            {employee && (
              <TouchableOpacity
                style={styles.profileIconButton}
                onPress={() => setShowProfileOverlay(true)}
                accessibilityLabel="My Profile"
              >
                <Text style={styles.profileIconText}>👤</Text>
              </TouchableOpacity>
            )}
            <Text style={[styles.title, employee && styles.titleWithLogout]}>BAK Attendance</Text>
          </View>
          {employee && (
            <TouchableOpacity style={styles.topLogoutButton} onPress={resetToIdle}>
              <Text style={styles.topLogoutText}>Log out</Text>
            </TouchableOpacity>
          )}
        </View>

        {!employee && !identifying && (
          <View style={styles.idleContainer}>
            <Text style={styles.subtitle}>Tap Punch and enter your Employee ID and code</Text>
            <TouchableOpacity style={styles.punchButton} onPress={handleScanSelf}>
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

      <IdentifyCodeForm
        visible={showIdentifyForm}
        onSubmit={handleIdentifySubmit}
        onCancel={() => setShowIdentifyForm(false)}
        title={identifyMode === 'team' ? "Enter Team Member's Code" : 'Enter Your Code'}
        directReports={identifyMode === 'team' ? directReports : undefined}
      />

      <ProfileOverlay
        visible={showProfileOverlay}
        profile={profile}
        loading={loadingProfile}
        onClose={() => setShowProfileOverlay(false)}
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
    borderRadius: 17,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIconText: { fontSize: 16 },
  topLogoutButton: { paddingVertical: 6, paddingHorizontal: 10 },
  topLogoutText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
  idleContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  subtitle: { fontSize: 15, color: '#6b7280', marginBottom: 24, marginTop: 12 },
  punchButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  punchButtonText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  identifiedContainer: { width: '100%' },
  onBehalfBanner: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
    marginBottom: 8,
  },
  scanAnotherContainer: { alignItems: 'center', paddingVertical: 24 },
  scanAnotherHint: { fontSize: 14, color: '#6b7280', marginBottom: 20, textAlign: 'center' },
  scanButton: {
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
  resetButton: { marginTop: 20, alignItems: 'center', paddingVertical: 10 },
  resetButtonText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
});
