import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import TaskPicker from '../components/TaskPicker';
import PunchButtons from '../components/PunchButtons';
import SupervisorPanel from '../components/SupervisorPanel';
import CreateTaskModal from '../components/CreateTaskModal';
import RejectReasonModal from '../components/RejectReasonModal';
import {
  identifyPunch,
  submitPunch,
  fetchPendingApprovals,
  approvePunch,
  rejectPunch,
  fetchDirectReports,
  fetchProjects,
  createTask,
  devIdentifyBypass,
} from '../api/client';
import { SUPERVISOR_DESIGNATION } from '../config';

// DEV ONLY — remove this constant, handleDevBypass, and the button that
// calls it once real face recognition replaces the exact-hash stub.
const DEV_BYPASS_EMP_ID = 'E1005';

export default function PunchScreen() {
  const [showCamera, setShowCamera] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [selectedProjectCode, setSelectedProjectCode] = useState(null);

  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [processingApprovalId, setProcessingApprovalId] = useState(null);
  const [directReports, setDirectReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [rejectingPunchId, setRejectingPunchId] = useState(null);

  const isSupervisor = employee?.designation === SUPERVISOR_DESIGNATION;

  function resetToIdle() {
    setEmployee(null);
    setSelectedProjectCode(null);
    setPendingApprovals([]);
    setDirectReports([]);
    setProjects([]);
  }

  const loadSupervisorData = useCallback(async (supervisorEmpId) => {
    setLoadingApprovals(true);
    try {
      const [approvals, reports, projectList] = await Promise.all([
        fetchPendingApprovals(supervisorEmpId),
        fetchDirectReports(supervisorEmpId),
        fetchProjects(),
      ]);
      setPendingApprovals(approvals || []);
      setDirectReports(reports || []);
      setProjects(projectList || []);
    } catch (err) {
      Alert.alert('Could not load team data', err.message);
    } finally {
      setLoadingApprovals(false);
    }
  }, []);

  async function handleCapture(photoUri) {
    setShowCamera(false);
    setIdentifying(true);
    try {
      const result = await identifyPunch(photoUri);
      setEmployee(result);
      if (result.tasks?.length === 1) {
        setSelectedProjectCode(result.tasks[0].project_code);
      }
      if (result.designation === SUPERVISOR_DESIGNATION) {
        loadSupervisorData(result.emp_id);
      }
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
      setEmployee(result);
      if (result.tasks?.length === 1) {
        setSelectedProjectCode(result.tasks[0].project_code);
      }
      if (result.designation === SUPERVISOR_DESIGNATION) {
        loadSupervisorData(result.emp_id);
      }
    } catch (err) {
      Alert.alert('Dev bypass failed', err.message);
    } finally {
      setIdentifying(false);
    }
  }

  async function handlePunch({ type, lat, lng }) {
    const result = await submitPunch({
      empId: employee.emp_id,
      type,
      projectCode: selectedProjectCode,
      lat,
      lng,
    });
    Alert.alert('Punch recorded', `${type === 'IN' ? 'Punched in' : 'Punched out'} successfully.`);
    return result;
  }

  async function handleApprove(punchId) {
    setProcessingApprovalId(punchId);
    try {
      await approvePunch(punchId, employee.emp_id);
      setPendingApprovals((prev) => prev.filter((p) => p.id !== punchId));
    } catch (err) {
      Alert.alert('Approve failed', err.message);
    } finally {
      setProcessingApprovalId(null);
    }
  }

  async function handleRejectSubmit(reason) {
    await rejectPunch(rejectingPunchId, employee.emp_id, reason);
    setPendingApprovals((prev) => prev.filter((p) => p.id !== rejectingPunchId));
    setRejectingPunchId(null);
  }

  async function handleCreateTask({ assignedEmpId, projectCode, priority, description, location }) {
    await createTask({ assignedEmpId, projectCode, priority, description, location, createdBy: employee.emp_id });
    setShowCreateTask(false);
    Alert.alert('Task created', 'The task was assigned successfully.');
  }

  const taskSelectionRequired = (employee?.tasks?.length ?? 0) > 1 && !selectedProjectCode;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>BAK Attendance</Text>

        {!employee && !identifying && (
          <View style={styles.idleContainer}>
            <Text style={styles.subtitle}>Tap Punch and look at the camera</Text>
            <TouchableOpacity style={styles.punchButton} onPress={() => setShowCamera(true)}>
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
            <TaskPicker
              tasks={employee.tasks}
              selectedProjectCode={selectedProjectCode}
              onSelect={setSelectedProjectCode}
            />
            <PunchButtons onPunch={handlePunch} disabled={taskSelectionRequired} />
            {taskSelectionRequired && (
              <Text style={styles.hint}>Select a task before punching in/out.</Text>
            )}

            {isSupervisor && (
              <SupervisorPanel
                pendingApprovals={pendingApprovals}
                loadingApprovals={loadingApprovals}
                onApprove={handleApprove}
                onReject={setRejectingPunchId}
                onCreateTask={() => setShowCreateTask(true)}
                processingId={processingApprovalId}
              />
            )}

            <TouchableOpacity style={styles.resetButton} onPress={resetToIdle}>
              <Text style={styles.resetButtonText}>Not you? Scan again</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <CameraCapture
        visible={showCamera}
        onCapture={handleCapture}
        onCancel={() => setShowCamera(false)}
      />

      <CreateTaskModal
        visible={showCreateTask}
        directReports={directReports}
        projects={projects}
        onSubmit={handleCreateTask}
        onClose={() => setShowCreateTask(false)}
      />

      <RejectReasonModal
        visible={rejectingPunchId != null}
        onSubmit={handleRejectSubmit}
        onClose={() => setRejectingPunchId(null)}
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
    marginTop: 28,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  devBypassButtonText: { color: '#b45309', fontSize: 12, fontWeight: '700' },
  identifiedContainer: { width: '100%' },
  hint: { color: '#dc2626', fontSize: 13, marginTop: 8, textAlign: 'center' },
  resetButton: { marginTop: 24, alignItems: 'center', paddingVertical: 10 },
  resetButtonText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
});
