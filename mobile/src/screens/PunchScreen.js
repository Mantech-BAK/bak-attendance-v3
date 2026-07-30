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

import CameraCapture from '../components/CameraCapture';
import EmployeeCard from '../components/EmployeeCard';
import TabBar from '../components/TabBar';
import PunchProjectList from '../components/PunchProjectList';
import TaskAssignmentForm from '../components/TaskAssignmentForm';
import ReviewAttendanceTab from '../components/ReviewAttendanceTab';
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
  fetchProjects,
  createTask,
  devIdentifyBypass,
} from '../api/client';
import { SUPERVISOR_DESIGNATION } from '../config';

// DEV ONLY — remove this constant, handleDevBypass, and the button that
// calls it once real face recognition replaces the exact-hash stub.
const DEV_BYPASS_EMP_ID = 'E1005';
// DEV ONLY — a direct report of DEV_BYPASS_EMP_ID, for testing "Scan Team
// Member" without real face recognition. Remove alongside the above.
const DEV_BYPASS_TEAM_EMP_ID = 'E1001';

const EMPLOYEE_TABS = [
  { key: 'punch', label: 'Punch' },
  { key: 'scan-another', label: 'Scan Another Employee' },
];

const SUPERVISOR_TABS = [
  { key: 'punch', label: 'Punch' },
  { key: 'task-assignment', label: 'Task Assignment' },
  { key: 'scan-team-member', label: 'Scan Team Member' },
  { key: 'review-attendance', label: 'Review Attendance' },
];

export default function PunchScreen() {
  const [showCamera, setShowCamera] = useState(false);
  const [cameraMode, setCameraMode] = useState('self'); // 'self' | 'team'
  const [identifying, setIdentifying] = useState(false);
  const [identifyingTeamMember, setIdentifyingTeamMember] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [activeTab, setActiveTab] = useState('punch');
  const [selfOpenProjectCode, setSelfOpenProjectCode] = useState(null);

  const [teamMemberTarget, setTeamMemberTarget] = useState(null);
  const [teamOpenProjectCode, setTeamOpenProjectCode] = useState(null);

  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [processingApprovalId, setProcessingApprovalId] = useState(null);
  const [pendingOtApprovals, setPendingOtApprovals] = useState([]);
  const [loadingOt, setLoadingOt] = useState(false);
  const [processingOtId, setProcessingOtId] = useState(null);
  const [directReports, setDirectReports] = useState([]);
  const [projects, setProjects] = useState([]);
  // { type: 'punch' | 'ot', id } — one modal shared by both approval flows.
  const [rejectingItem, setRejectingItem] = useState(null);

  const isSupervisor = employee?.designation === SUPERVISOR_DESIGNATION;
  const tabs = isSupervisor ? SUPERVISOR_TABS : EMPLOYEE_TABS;

  function resetToIdle() {
    setEmployee(null);
    setActiveTab('punch');
    setSelfOpenProjectCode(null);
    setTeamMemberTarget(null);
    setTeamOpenProjectCode(null);
    setPendingApprovals([]);
    setPendingOtApprovals([]);
    setDirectReports([]);
    setProjects([]);
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

  async function applySelfIdentifyResult(result) {
    setEmployee(result);
    setActiveTab('punch');
    setTeamMemberTarget(null);
    setTeamOpenProjectCode(null);

    const status = await fetchTodayPunchStatus(result.emp_id);
    setSelfOpenProjectCode(status.open_project_code);

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
    setTeamOpenProjectCode(status.open_project_code);
  }

  async function handleCapture(photoUri) {
    setShowCamera(false);

    if (cameraMode === 'team') {
      setIdentifyingTeamMember(true);
      try {
        const result = await identifyPunch(photoUri);
        await applyTeamMemberResult(result);
      } catch (err) {
        Alert.alert('Face not recognized', err.message);
      } finally {
        setIdentifyingTeamMember(false);
      }
      return;
    }

    setIdentifying(true);
    try {
      const result = await identifyPunch(photoUri);
      await applySelfIdentifyResult(result);
    } catch (err) {
      Alert.alert('Face not recognized', err.message);
    } finally {
      setIdentifying(false);
    }
  }

  // DEV ONLY — see DEV_BYPASS_EMP_ID above.
  async function handleDevBypass() {
    setIdentifying(true);
    try {
      const result = await devIdentifyBypass(DEV_BYPASS_EMP_ID);
      await applySelfIdentifyResult(result);
    } catch (err) {
      Alert.alert('Dev bypass failed', err.message);
    } finally {
      setIdentifying(false);
    }
  }

  // DEV ONLY — see DEV_BYPASS_TEAM_EMP_ID above.
  async function handleDevBypassTeamMember() {
    setIdentifyingTeamMember(true);
    try {
      const result = await devIdentifyBypass(DEV_BYPASS_TEAM_EMP_ID);
      await applyTeamMemberResult(result);
    } catch (err) {
      Alert.alert('Dev bypass failed', err.message);
    } finally {
      setIdentifyingTeamMember(false);
    }
  }

  function handleScanTeamMember() {
    setCameraMode('team');
    setShowCamera(true);
  }

  function handleScanSelf() {
    setCameraMode('self');
    setShowCamera(true);
  }

  async function handlePunchSelf(projectCode, projectName, { lat, lng }) {
    const wasOpen = selfOpenProjectCode === projectCode;
    await submitPunch({ empId: employee.emp_id, projectCode, lat, lng });

    const status = await fetchTodayPunchStatus(employee.emp_id);
    setSelfOpenProjectCode(status.open_project_code);

    Alert.alert('Punch recorded', wasOpen ? `${projectName} closed.` : `${projectName} is now open.`);
  }

  async function handlePunchTeamMember(projectCode, projectName, { lat, lng }) {
    const wasOpen = teamOpenProjectCode === projectCode;
    await submitPunch({ empId: teamMemberTarget.emp_id, projectCode, lat, lng, enteredBy: employee.emp_id });

    const status = await fetchTodayPunchStatus(teamMemberTarget.emp_id);
    setTeamOpenProjectCode(status.open_project_code);

    Alert.alert(
      'Punch recorded',
      wasOpen
        ? `${teamMemberTarget.name}'s ${projectName} was closed.`
        : `${teamMemberTarget.name}'s ${projectName} is now open.`
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
            <Text style={styles.scanButtonText}>Scan</Text>
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
              <Text style={styles.scanButtonText}>Scan Team Member</Text>
            </TouchableOpacity>

            {/* DEV ONLY — remove alongside DEV_BYPASS_TEAM_EMP_ID above. */}
            <TouchableOpacity style={styles.devBypassButton} onPress={handleDevBypassTeamMember}>
              <Text style={styles.devBypassButtonText}>
                DEV: Scan Team Member ({DEV_BYPASS_TEAM_EMP_ID})
              </Text>
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

    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>BAK Attendance</Text>

        {!employee && !identifying && (
          <View style={styles.idleContainer}>
            <Text style={styles.subtitle}>Tap Punch and look at the camera</Text>
            <TouchableOpacity style={styles.punchButton} onPress={handleScanSelf}>
              <Text style={styles.punchButtonText}>Punch</Text>
            </TouchableOpacity>

            {/* DEV ONLY — remove this button along with handleDevBypass and DEV_BYPASS_EMP_ID above. */}
            <TouchableOpacity style={styles.devBypassButton} onPress={handleDevBypass}>
              <Text style={styles.devBypassButtonText}>DEV: Skip Face ID ({DEV_BYPASS_EMP_ID})</Text>
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

            <TouchableOpacity style={styles.resetButton} onPress={resetToIdle}>
              <Text style={styles.resetButtonText}>Log out</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <CameraCapture
        visible={showCamera}
        onCapture={handleCapture}
        onCancel={() => setShowCamera(false)}
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
  title: { fontSize: 24, fontWeight: '800', color: '#111827', marginTop: 16, marginBottom: 24 },
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
  devBypassButton: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  devBypassButtonText: { color: '#b45309', fontSize: 12, fontWeight: '700' },
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
