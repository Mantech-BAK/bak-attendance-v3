require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./db');
const syncRoutes = require('./routes/sync');
const employeeRoutes = require('./routes/employees');
const punchIdentifyRoutes = require('./routes/punch');
const punchesRoutes = require('./routes/punches');
const tasksRoutes = require('./routes/tasks');
const projectsRoutes = require('./routes/projects');
const attendanceRoutes = require('./routes/attendance');
const devBypassRoutes = require('./routes/devBypass'); // DEV ONLY — remove with routes/devBypass.js once real face recognition lands
const { startArtifyCron } = require('./jobs/artifyCron');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

app.use('/api/sync', syncRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/punch', punchIdentifyRoutes);
app.use('/api/punches', punchesRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dev', devBypassRoutes); // DEV ONLY — remove with routes/devBypass.js once real face recognition lands

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startArtifyCron();
});
