// IMMEDIATE TEST - This should run as soon as the script loads
(function() {
    console.log('SCRIPT.JS LOADED SUCCESSFULLY');
    console.log('Window object:', typeof window);
    console.log('Document object:', typeof document);
})();

console.log('Script loading...');

// Global variables - will be set when DOM is ready
let video, videoLoader, statusBadge, registerBtn, studentNameInput, regFeedback;
let attendanceBody, presentCount, exportBtn, loginBtn;

// LocalStorage Keys
const FACES_KEY = 'smart_attendance_faces';
const LOG_KEY = 'smart_attendance_log';
const TIMETABLE_KEY = 'smart_attendance_timetable';
const HISTORY_KEY = 'smart_attendance_history';

// State
let attendanceHistory = { sessions: [], studentAttendance: {} };
let labeledFaceDescriptors = [];
let faceMatcher = null;
let allAttendanceLogs = new Map(); // classKey -> Map(Name -> Data)
let currentClass = null;           // active class key (set by timetable)
let activeTimetableEntry = null;   // The actual timetable object for current session
let attendanceLog = new Map();     // points to current class's log
let studentMetadata = new Map();   // name -> { course, section, specialization }
let isRecognizing = true;
let lastAttendanceMark = new Map();
let loggedInUser = null;           // { username, role } of logged-in user
let timetable = [];                // Array of timetable entries
let scheduleCheckInterval = null;  // interval id

// These will be initialized once the camera starts
let canvas = null;
let displaySize = null;

// ─── Timetable helpers ────────────────────────────────────────────────────────

/** Load timetable from localStorage */
function loadTimetable() {
    const stored = localStorage.getItem(TIMETABLE_KEY);
    timetable = stored ? JSON.parse(stored) : [];
}

/** Save timetable to localStorage */
function saveTimetable() {
    localStorage.setItem(TIMETABLE_KEY, JSON.stringify(timetable));
}

/** Add a new timetable entry */
function addTimetableEntry(entry) {
    entry.id = Date.now().toString();
    timetable.push(entry);
    saveTimetable();
}

/** Remove a timetable entry by id */
function removeTimetableEntry(id) {
    timetable = timetable.filter(e => e.id !== id);
    saveTimetable();
}

/** Return 'HH:MM' for current time */
function getCurrentTimeStr() {
    const now = new Date();
    return now.toTimeString().slice(0, 5); // 'HH:MM'
}

/** Today's day name, e.g. 'Monday' */
function getTodayName() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * Get the active timetable entry for a given username at the current moment.
 * For admins/super: return any active entry (or null — admin can see all).
 */
function getActiveEntryForUser(username, role) {
    const nowStr = getCurrentTimeStr();
    const todayName = getTodayName();
    let entries = timetable;
    if (role === 'faculty') {
        entries = timetable.filter(e => e.facultyUsername === username);
    }
    return entries.find(e => {
        return e.days.includes(todayName) && nowStr >= e.startTime && nowStr <= e.endTime;
    }) || null;
}

/**
 * Find the next upcoming entry for a faculty today (for the 'Next class' hint).
 */
function getNextEntryForUser(username, role) {
    const nowStr = getCurrentTimeStr();
    const todayName = getTodayName();
    let entries = timetable;
    if (role === 'faculty') {
        entries = timetable.filter(e => e.facultyUsername === username);
    }
    const upcoming = entries
        .filter(e => e.days.includes(todayName) && e.startTime > nowStr)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
    return upcoming[0] || null;
}

/**
 * Build a unique class key from a timetable entry.
 */
function entryToClassKey(entry) {
    const type  = entry.type  || 'Lecture';
    const batch = entry.batch || 'All';
    const spec  = entry.specialization || 'All';
    let key = `${entry.course} | ${entry.section}`;
    if (spec !== 'All')   key += ` | ${spec}`;
    if (type === 'Lab' && batch !== 'All') key += ` | ${batch}`;
    key += ` | ${entry.subject}`;
    if (type === 'Lab') key += ` (Lab)`;
    return key;
}

/**
 * Evaluate and apply the active class based on the current time and loggedInUser.
 * Called on login and every minute via interval.
 */
function evaluateActiveClass() {
    if (!loggedInUser) return;

    const entry = getActiveEntryForUser(loggedInUser.username, loggedInUser.role);
    const cameraEl   = document.getElementById('cameraSection');
    const noClassEl  = document.getElementById('noClassOverlay');
    const bannerEl   = document.getElementById('activeClassBanner');
    const subjectLbl = document.getElementById('activeSubjectLabel');
    const classLbl   = document.getElementById('activeClassLabel');
    const timeLbl    = document.getElementById('activeTimeLabel');
    const curLbl     = document.getElementById('currentClassLabel');
    const nextInfo   = document.getElementById('nextClassInfo');

    if (entry) {
        activeTimetableEntry = entry;
        const key = entryToClassKey(entry);
        switchClass(key);

        // Record history session
        const sessionId = `${new Date().toDateString()} | ${entry.id}`;
        let sessionExists = attendanceHistory.sessions.find(s => s.id === sessionId);
        if (!sessionExists) {
            attendanceHistory.sessions.push({
                id: sessionId,
                course: entry.course,
                section: entry.section,
                specialization: entry.specialization,
                subject: entry.subject,
                date: new Date().toDateString()
            });
            saveHistoryToStorage();
        }

        // Show banner
        if (bannerEl)  bannerEl.style.display  = 'block';
        if (cameraEl)  cameraEl.style.display  = 'block';
        if (noClassEl) noClassEl.style.display = 'none';
        const entryType  = entry.type  || 'Lecture';
        const entryBatch = entry.batch || 'All';
        const entrySpec  = entry.specialization || 'All';
        const batchLabel = (entryType === 'Lab' && entryBatch !== 'All') ? ` — ${entryBatch}` : '';
        const specLabel  = entrySpec !== 'All' ? ` [${entrySpec}]` : '';
        const typeTag    = entryType === 'Lab' ? ' 🧪 Lab' : '';
        if (subjectLbl) subjectLbl.textContent = `${entry.subject}${typeTag}`;
        if (classLbl)   classLbl.textContent   = `${entry.course} — Section ${entry.section}${specLabel}${batchLabel}`;
        if (timeLbl)    timeLbl.textContent     = `${entry.startTime} – ${entry.endTime}`;
        if (curLbl)     curLbl.textContent      = entryToClassKey(entry);

        // Start camera if not running
        if (video && !video.srcObject) {
            if (statusBadge && statusBadge.classList.contains('ready')) {
                initCamera();
            } else {
                loadModels();
            }
        }
    } else {
        // No active class
        currentClass = null;
        activeTimetableEntry = null;
        attendanceLog = new Map();

        if (bannerEl)  bannerEl.style.display  = 'none';
        if (curLbl)    curLbl.textContent       = 'No active class';

        // Admin: still show the camera, just no class is set.
        if (loggedInUser.role === 'admin' || loggedInUser.role === 'super') {
            if (cameraEl)  cameraEl.style.display  = 'block';
            if (noClassEl) noClassEl.style.display = 'none';
            if (bannerEl)  bannerEl.style.display  = 'none';
            // Start camera if not running
            if (video && !video.srcObject) {
                if (statusBadge && statusBadge.classList.contains('ready')) {
                    initCamera();
                } else {
                    loadModels();
                }
            }
        } else {
            // Faculty: hide camera, show no-class screen
            if (cameraEl)  cameraEl.style.display  = 'none';
            if (noClassEl) noClassEl.style.display = 'block';

            // Show next class info
            const next = getNextEntryForUser(loggedInUser.username, loggedInUser.role);
            if (nextInfo) {
                if (next) {
                    nextInfo.textContent = `Your next class: ${next.subject} | ${next.course} — Section ${next.section} at ${next.startTime}`;
                } else {
                    nextInfo.textContent = 'You have no more classes scheduled today.';
                }
            }

            // Stop camera if running
            if (video && video.srcObject) {
                video.srcObject.getTracks().forEach(t => t.stop());
                video.srcObject = null;
            }
        }
        updateAttendanceTable();
    }
}

function switchClass(newClass) {
    currentClass = newClass;
    if (!allAttendanceLogs.has(currentClass)) {
        allAttendanceLogs.set(currentClass, new Map());
    }
    attendanceLog = allAttendanceLogs.get(currentClass);
    if (typeof updateAttendanceTable === 'function') {
        updateAttendanceTable();
    }
}

// ─── Timetable Modal ──────────────────────────────────────────────────────────

function openTimetableModal() {
    closeTimetableModal(); // remove if exists
    const modal = document.createElement('div');
    modal.id = 'timetableModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:1002;display:flex;align-items:center;justify-content:center;';

    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const facultyOptions = adminUsers.map(u => `<option value="${u.username}">${u.username} (${u.role})</option>`).join('');
    const courses = ['B.Tech CSE','B.Tech IT','B.Tech ECE','B.Tech ME','B.Tech CE','MCA','MBA','BCA','B.Sc CS'];
    const sections = ['A','B','C','D','E','F'];

    const specializations = ['All (Mixed)', 'Artificial Intelligence', 'Data Science', 'Cyber Security', 'Cloud Computing', 'Machine Learning', 'Internet of Things', 'Blockchain', 'Full Stack Dev', 'VLSI', 'Embedded Systems', 'Robotics'];
    const specOptions = specializations.map(s => `<option value="${s === 'All (Mixed)' ? 'All' : s}">${s}</option>`).join('');

    const rowsHtml = timetable.length === 0 
        ? `<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:20px;">No timetable entries yet.</td></tr>`
        : timetable.map(e => {
            const eType  = e.type  || 'Lecture';
            const eBatch = e.batch || 'All';
            const eSpec  = e.specialization || 'All';
            const typeTag  = eType === 'Lab' ? '🧪 Lab' : '📖 Lecture';
            const batchTag = (eType === 'Lab' && eBatch !== 'All') ? eBatch : (eType === 'Lab' ? 'All' : '—');
            const specTag  = eSpec !== 'All' ? eSpec : '—';
            return `
            <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px 4px;">${e.facultyUsername}</td>
                <td style="padding:6px 4px;">${e.subject}</td>
                <td style="padding:6px 4px;">${e.course}</td>
                <td style="padding:6px 4px;text-align:center;">${e.section}</td>
                <td style="padding:6px 4px;font-size:0.78rem;">${specTag}</td>
                <td style="padding:6px 4px;text-align:center;">${typeTag}</td>
                <td style="padding:6px 4px;text-align:center;">${batchTag}</td>
                <td style="padding:6px 4px;text-align:center;">${e.startTime}–${e.endTime}</td>
                <td style="padding:6px 4px;font-size:0.75rem;">${e.days.join(', ')}</td>
                <td style="padding:6px 4px;text-align:center;"><button onclick="removeTimetableEntry('${e.id}');closeTimetableModal();openTimetableModal();" style="background:#ef4444;color:white;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;">✕</button></td>
            </tr>`;
        }).join('');

    modal.innerHTML = `
        <div style="background:var(--bg-secondary);border-radius:14px;padding:28px;width:95%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
            <h2 style="margin-top:0;color:var(--text-main);text-align:center;">📅 Manage Timetable</h2>

            <!-- Existing entries table -->
            <div style="overflow-x:auto;margin-bottom:24px;">
                <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
                    <thead>
                        <tr style="border-bottom:2px solid var(--border);color:var(--text-muted);">
                            <th style="padding:6px 4px;text-align:left;">Faculty</th>
                            <th style="padding:6px 4px;text-align:left;">Subject</th>
                            <th style="padding:6px 4px;text-align:left;">Course</th>
                            <th style="padding:6px 4px;text-align:center;">Sec</th>
                            <th style="padding:6px 4px;text-align:left;">Specialization</th>
                            <th style="padding:6px 4px;text-align:center;">Type</th>
                            <th style="padding:6px 4px;text-align:center;">Batch</th>
                            <th style="padding:6px 4px;text-align:center;">Time</th>
                            <th style="padding:6px 4px;text-align:left;">Days</th>
                            <th style="padding:6px 4px;"></th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>

            <!-- Add new entry form -->
            <h3 style="color:var(--text-main);margin-bottom:12px;">Add New Entry</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
                <div>
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Faculty</label>
                    <select id="tt_faculty" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);">${facultyOptions}</select>
                </div>
                <div>
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Subject</label>
                    <input type="text" id="tt_subject" placeholder="e.g. Mathematics" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Course</label>
                    <select id="tt_course" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);">${courses.map(c=>`<option>${c}</option>`).join('')}</select>
                </div>
                <div>
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Section</label>
                    <select id="tt_section" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);">${sections.map(s=>`<option>${s}</option>`).join('')}</select>
                </div>
                <div style="grid-column:1/-1;">
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Specialization <span style="color:var(--text-muted);font-size:0.75rem;">(select 'All (Mixed)' if class has multiple specializations)</span></label>
                    <select id="tt_specialization" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);">${specOptions}</select>
                </div>
                <div>
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Start Time</label>
                    <input type="time" id="tt_start" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">End Time</label>
                    <input type="time" id="tt_end" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Type</label>
                    <select id="tt_type" onchange="toggleBatchField()" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);">
                        <option value="Lecture">📖 Lecture (~1 hr)</option>
                        <option value="Lab">🧪 Lab (~2 hrs)</option>
                    </select>
                </div>
                <div id="tt_batch_wrapper">
                    <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:4px;">Batch <span style="color:#f59e0b;font-size:0.75rem;">(for Lab splits)</span></label>
                    <select id="tt_batch" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-main);">
                        <option value="All">All (no split)</option>
                        <option value="Batch 1">Batch 1</option>
                        <option value="Batch 2">Batch 2</option>
                        <option value="Batch 3">Batch 3</option>
                    </select>
                </div>
            </div>
            <div style="margin-bottom:14px;">
                <label style="font-size:0.8rem;color:var(--text-muted);display:block;margin-bottom:6px;">Days</label>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${days.map(d=>`<label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;"><input type="checkbox" value="${d}" class="tt_day_cb" ${['Monday','Tuesday','Wednesday','Thursday','Friday'].includes(d)?'checked':''}> ${d}</label>`).join('')}
                </div>
            </div>
            <div style="display:flex;gap:10px;">
                <button onclick="submitTimetableEntry()" style="background:#10b981;color:white;border:none;border-radius:6px;padding:10px 20px;cursor:pointer;font-size:0.9rem;font-weight:600;">Add Entry</button>
                <button onclick="closeTimetableModal()" class="secondary-btn" style="flex:1;">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function closeTimetableModal() {
    const m = document.getElementById('timetableModal');
    if (m) m.remove();
}

function submitTimetableEntry() {
    const faculty        = document.getElementById('tt_faculty').value.trim();
    const subject        = document.getElementById('tt_subject').value.trim();
    const course         = document.getElementById('tt_course').value;
    const section        = document.getElementById('tt_section').value;
    const specialization = document.getElementById('tt_specialization').value;
    const start          = document.getElementById('tt_start').value;
    const end            = document.getElementById('tt_end').value;
    const type           = document.getElementById('tt_type').value;
    const batch          = document.getElementById('tt_batch').value;
    const days           = Array.from(document.querySelectorAll('.tt_day_cb:checked')).map(cb => cb.value);

    if (!faculty || !subject || !start || !end || days.length === 0) {
        alert('Please fill Faculty, Subject, Start Time, End Time and select at least one day.');
        return;
    }
    if (start >= end) {
        alert('End time must be after start time.');
        return;
    }
    addTimetableEntry({ facultyUsername: faculty, subject, course, section, specialization, type, batch, startTime: start, endTime: end, days });
    closeTimetableModal();
    openTimetableModal();
}

function toggleBatchField() {
    const typeEl    = document.getElementById('tt_type');
    const batchWrap = document.getElementById('tt_batch_wrapper');
    if (!typeEl || !batchWrap) return;
    batchWrap.style.opacity  = typeEl.value === 'Lab' ? '1' : '0.4';
    batchWrap.style.pointerEvents = typeEl.value === 'Lab' ? 'auto' : 'none';
}


// Admin user management
const ADMIN_USERS_KEY = 'smart_attendance_admin_users';
let adminUsers = [];

// Load admin users from localStorage
function loadAdminUsers() {
    const stored = localStorage.getItem(ADMIN_USERS_KEY);
    if (stored) {
        adminUsers = JSON.parse(stored);
    } else {
        // Initialize with default admin
        adminUsers = [{ username: 'admin', password: 'admin123', role: 'super' }];
        saveAdminUsers();
    }
}

// Save admin users to localStorage
function saveAdminUsers() {
    localStorage.setItem(ADMIN_USERS_KEY, JSON.stringify(adminUsers));
}

// Check if user is admin
function isValidAdmin(username, password) {
    return adminUsers.some(user => user.username === username && user.password === password);
}

// Add new admin user (only super admins can do this)
function addAdminUser(username, password, role = 'admin') {
    if (adminUsers.some(user => user.username === username)) {
        return false; // Username already exists
    }
    adminUsers.push({ username, password, role });
    saveAdminUsers();
    return true;
}

// Remove admin user (only super admins can do this)
function removeAdminUser(username) {
    const index = adminUsers.findIndex(user => user.username === username);
    if (index > -1 && adminUsers[index].role !== 'super') {
        adminUsers.splice(index, 1);
        saveAdminUsers();
        return true;
    }
    return false;
}
function openLoginModal() {
    console.log('openLoginModal called');
    const modal = document.getElementById('loginModal');
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const error = document.getElementById('loginError');
    
    console.log('Modal element found:', modal);
    console.log('Username input found:', usernameInput);
    console.log('Password input found:', passwordInput);
    console.log('Error element found:', error);
    
    if (modal) {
        modal.style.display = 'flex';
        console.log('Modal set to display: flex');
        
        // Focus the username field after a short delay to ensure modal is visible
        setTimeout(() => {
            if (usernameInput) {
                usernameInput.value = '';
                usernameInput.focus();
                console.log('Username field focused and cleared');
            }
            if (passwordInput) {
                passwordInput.value = '';
            }
        }, 100);
        
        if (error) {
            error.style.display = 'none';
        }
    } else {
        console.error('Login Modal NOT FOUND!');
    }
}

function closeLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function submitLogin() {
    console.log('submitLogin() called!');
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const error = document.getElementById('loginError');
    
    console.log('Username input found:', !!usernameInput);
    console.log('Password input found:', !!passwordInput);
    console.log('Error element found:', !!error);
    
    if (!usernameInput || !passwordInput) {
        console.error('Login inputs not found!');
        return;
    }
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    console.log('Username provided:', username);
    console.log('Password provided:', password ? '***' : 'empty');
    
    const studentMeta = studentMetadata.get(username);
    const isValidStudent = studentMeta && (studentMeta.password === password || (!studentMeta.password && password === 'student'));
    
    const userRoleObj = adminUsers.find(user => user.username === username && user.password === password) 
        || (isValidStudent ? { username: username, role: 'student' } : null);
    
    if (userRoleObj) {
        console.log(`✓ Login CORRECT - Enabling ${userRoleObj.role} mode`);
        closeLoginModal();
        
        // Store logged-in user
        loggedInUser = { username: userRoleObj.username, role: userRoleObj.role };

        if (userRoleObj.role === 'admin' || userRoleObj.role === 'super') {
            document.body.classList.add('admin-mode');
        } else if (userRoleObj.role === 'faculty') {
            document.body.classList.add('faculty-mode');
        } else if (userRoleObj.role === 'student') {
            document.body.classList.add('student-mode');
        }
        
        if (loginBtn) {
            loginBtn.textContent = `Logout (${username})`;
            loginBtn.style.background = 'var(--danger)';
            loginBtn.style.color = 'white';
            loginBtn.style.borderColor = 'var(--danger)';
        }
        
        if (typeof updateRegisterButtonState === 'function') {
            updateRegisterButtonState();
        }

        // Show main content
        const mainContent = document.querySelector('.main-content');
        const loginPlaceholder = document.getElementById('loginPlaceholder');
        const studentDashboard = document.getElementById('studentDashboard');

        if (userRoleObj.role === 'student') {
            if (mainContent) mainContent.style.display = 'none';
            if (loginPlaceholder) loginPlaceholder.style.display = 'none';
            if (studentDashboard) studentDashboard.style.display = 'block';
            renderStudentDashboard(userRoleObj.username);
        } else {
            if (mainContent) mainContent.style.display = '';
            if (loginPlaceholder) loginPlaceholder.style.display = 'none';
            if (studentDashboard) studentDashboard.style.display = 'none';

            // Load models first (evaluateActiveClass will start camera after)
            loadTimetable();
            evaluateActiveClass();

            // Re-evaluate every 60 seconds
            if (scheduleCheckInterval) clearInterval(scheduleCheckInterval);
            scheduleCheckInterval = setInterval(evaluateActiveClass, 60000);
        }

        console.log('=== LOGIN SUCCESSFUL ===');
    } else {
        console.log('✗ Login INCORRECT');
        if (error) {
            error.textContent = 'Invalid username or password.';
            error.style.display = 'block';
        }
        if (usernameInput) {
            usernameInput.focus();
        }
    }
}

function toggleLogin() {
    const isAdmin = document.body.classList.contains('admin-mode');
    const isFaculty = document.body.classList.contains('faculty-mode');
    const isStudent = document.body.classList.contains('student-mode');
    
    if (isAdmin || isFaculty || isStudent) {
        // Logout
        loggedInUser = null;
        if (scheduleCheckInterval) { clearInterval(scheduleCheckInterval); scheduleCheckInterval = null; }

        document.body.classList.remove('admin-mode');
        document.body.classList.remove('faculty-mode');
        document.body.classList.remove('student-mode');
        
        loginBtn.textContent = 'Login';
        loginBtn.style.background = 'transparent';
        loginBtn.style.color = 'var(--text-main)';
        loginBtn.style.borderColor = 'var(--border)';
        if (typeof updateRegisterButtonState === 'function') {
            updateRegisterButtonState();
        }

        // Hide main content, show placeholder
        const mainContent = document.querySelector('.main-content');
        const loginPlaceholder = document.getElementById('loginPlaceholder');
        const studentDashboard = document.getElementById('studentDashboard');
        
        if (mainContent) mainContent.style.display = 'none';
        if (studentDashboard) studentDashboard.style.display = 'none';
        if (loginPlaceholder) loginPlaceholder.style.display = '';
        
        // Stop camera
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        // Reset UI
        const bannerEl = document.getElementById('activeClassBanner');
        const curLbl   = document.getElementById('currentClassLabel');
        if (bannerEl) bannerEl.style.display = 'none';
        if (curLbl)   curLbl.textContent = 'No active class';
    } else {
        openLoginModal();
    }
}
// Admin user management functions
function openUserManagementModal() {
    // Create modal for managing users
    const modal = document.createElement('div');
    modal.id = 'userManagementModal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
        background: rgba(0, 0, 0, 0.7); z-index: 1001; display: flex; 
        align-items: center; justify-content: center;
    `;
    
    modal.innerHTML = `
        <div style="background: var(--bg-secondary); border-radius: 12px; padding: 30px; width: 90%; max-width: 500px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);">
            <h2 style="margin-top: 0; color: var(--text-main); text-align: center;">Manage Users</h2>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: var(--text-main); margin-bottom: 10px;">Current Users:</h3>
                <div id="userList" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 10px;">
                    ${adminUsers.map(user => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--border);">
                            <span>${user.username} (${user.role})</span>
                            ${user.role !== 'super' ? `<button onclick="removeAdminUser('${user.username}')" style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer;">Remove</button>` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Super Admin</span>'}
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: var(--text-main); margin-bottom: 10px;">Add New User:</h3>
                <input type="text" id="newAdminUsername" placeholder="Username" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-primary); color: var(--text-main);">
                <input type="password" id="newAdminPassword" placeholder="Password" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-primary); color: var(--text-main);">
                <select id="newUserRole" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-primary); color: var(--text-main);">
                    <option value="admin">Admin</option>
                    <option value="faculty">Faculty</option>
                </select>
                <button onclick="addNewAdmin()" style="background: var(--success); color: white; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer;">Add User</button>
            </div>
            
            <div style="display: flex; gap: 10px;">
                <button onclick="closeUserManagementModal()" class="secondary-btn" style="flex: 1;">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function closeUserManagementModal() {
    const modal = document.getElementById('userManagementModal');
    if (modal) {
        modal.remove();
    }
}

function addNewAdmin() {
    const username = document.getElementById('newAdminUsername').value.trim();
    const password = document.getElementById('newAdminPassword').value;
    const role = document.getElementById('newUserRole').value;
    
    if (!username || !password) {
        alert('Please enter both username and password.');
        return;
    }
    
    if (addAdminUser(username, password, role)) {
        alert(`User "${username}" added successfully as ${role}!`);
        closeUserManagementModal();
        openUserManagementModal(); // Refresh the list
    } else {
        alert('Username already exists.');
    }
}

// Wait for DOM to be fully loaded before getting elements and starting app
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded fired - getting DOM elements');
    
    // Load admin users and timetable first
    loadAdminUsers();
    loadTimetable();
    loadHistoryFromStorage();
    
    // Get DOM elements
    video = document.getElementById('videoElement');
    videoLoader = document.getElementById('videoLoader');
    statusBadge = document.getElementById('statusBadge');

    registerBtn = document.getElementById('registerBtn');
    studentNameInput = document.getElementById('studentName');
    regFeedback = document.getElementById('regFeedback');

    attendanceBody = document.getElementById('attendanceBody');
    presentCount = document.getElementById('presentCount');
    exportBtn = document.getElementById('exportBtn');
    loginBtn = document.getElementById('loginBtn');

    console.log('Login button element:', loginBtn);
    console.log('All elements loaded:', { video, videoLoader, statusBadge, registerBtn, studentNameInput, regFeedback, attendanceBody, presentCount, exportBtn, loginBtn });

    // Add event listeners for login modal
    const loginConfirmBtn = document.getElementById('loginConfirmBtn');
    const loginCancelBtn = document.getElementById('loginCancelBtn');
    const usernameInputModal = document.getElementById('usernameInput');
    const passwordInputModal = document.getElementById('passwordInput');
    
    if (loginConfirmBtn) {
        loginConfirmBtn.addEventListener('click', submitLogin);
    }
    if (loginCancelBtn) {
        loginCancelBtn.addEventListener('click', closeLoginModal);
    }
    if (usernameInputModal) {
        usernameInputModal.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                passwordInputModal.focus();
            }
        });
    }
    if (passwordInputModal) {
        passwordInputModal.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                submitLogin();
            }
        });
    }

    // Listen to name input changes
    if (studentNameInput) {
        studentNameInput.addEventListener('input', updateRegisterButtonState);
    }

    // Register button
    if (registerBtn) {
        registerBtn.addEventListener('click', async () => {
            const name = studentNameInput.value.trim();
            if (!name) {
                showFeedback('Please enter a name first.', 'error');
                return;
            }

            if (attendanceLog.has(name)) {
                showFeedback('Name already exists in session.', 'error');
                return;
            }

            const course = document.getElementById('regCourse').value;
            const section = document.getElementById('regSection').value;
            const specialization = document.getElementById('regSpecialization').value;
            const password = document.getElementById('regPassword').value;

            if (!password) {
                showFeedback('Please set a password for the student.', 'error');
                return;
            }

            // Pause recognizing while capturing
            isRecognizing = false;
            registerBtn.disabled = true;
            regFeedback.textContent = `Capturing face for ${name} (${course} - ${section})...`;
            regFeedback.className = 'feedback warning';

            try {
                // Capture multiple face descriptors for better accuracy
                const descriptors = [];
                const numCaptures = 3;

                for (let i = 0; i < numCaptures; i++) {
                    regFeedback.textContent = `Capturing face ${i + 1}/${numCaptures}...`;

                    // Wait a moment between captures
                    if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }

                    // Detect single best face
                    const detection = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options({
                        minConfidence: 0.8
                    }))
                        .withFaceLandmarks()
                        .withFaceDescriptor();

                    if (!detection) {
                        throw new Error(`No clear face detected in capture ${i + 1}. Try again.`);
                    }

                    descriptors.push(detection.descriptor);
                }

                // Store all descriptors for this person
                labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(name, descriptors));
                
                // Store metadata
                studentMetadata.set(name, { course, section, specialization, password });

                // SAVE FACES TO STORAGE
                saveFacesToStorage();

                // Rebuild Matcher
                faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.6);

                // Success!
                showFeedback(`Successfully registered: ${name} (${numCaptures} face captures)`, 'success');
                studentNameInput.value = '';
                document.getElementById('regPassword').value = '';

                // Auto mark them present upon registration
                markAttendance(name);

            } catch (e) {
                console.error(e);
                showFeedback(e.message || 'Error processing image.', 'error');
            }

            // Resume
            isRecognizing = true;
            registerBtn.disabled = false;
            updateRegisterButtonState();
        });
    }

    // Reset log button
    const resetLogBtnEl = document.getElementById('resetLogBtn');
    if (resetLogBtnEl) {
        resetLogBtnEl.addEventListener('click', () => {
            if (confirm(`Are you sure you want to clear today's attendance log for ${currentClass}?`)) {
                attendanceLog.clear();
                saveLogToStorage();
                updateAttendanceTable();
                showFeedback(`Attendance reset for ${currentClass}.`, 'success');
            }
        });
    }

    // Clear all data button
    const clearDataBtnEl = document.getElementById('clearDataBtn');
    if (clearDataBtnEl) {
        clearDataBtnEl.addEventListener('click', () => {
            if (confirm('WARNING: This will permanently delete all registered faces AND ALL logs. Are you sure?')) {
                labeledFaceDescriptors = [];
                faceMatcher = null;
                allAttendanceLogs.clear();
                attendanceLog = new Map();
                allAttendanceLogs.set(currentClass, attendanceLog);
                attendanceHistory = { sessions: [], studentAttendance: {} };
                localStorage.removeItem(FACES_KEY);
                localStorage.removeItem(LOG_KEY);
                localStorage.removeItem(HISTORY_KEY);
                updateAttendanceTable();
                showFeedback('All data cleared!', 'success');
            }
        });
    }

    // Export to CSV button
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (attendanceLog.size === 0) return alert('No attendance to export.');
            
            let csvContent = "data:text/csv;charset=utf-8,Name,Course,Section,Specialization,Time Present\n";
            attendanceLog.forEach((data, name) => {
                const time = typeof data === 'string' ? data : data.time;
                const meta = studentMetadata.get(name) || { course: '?', section: '?', specialization: '?' };
                csvContent += `"${name}","${meta.course}","${meta.section}","${meta.specialization}","${time}"\n`;
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `Attendance_Log_${currentClass}_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    // Keyboard shortcut Ctrl+Shift+A for login
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'A') {
            e.preventDefault();
            toggleLogin();
        }
    });

});

// Helper to update register button state
function updateRegisterButtonState() {
    if (!registerBtn || !studentNameInput) return;
    const isAdmin = document.body.classList.contains('admin-mode');
    const hasName = studentNameInput.value.trim().length > 0;
    registerBtn.disabled = !isAdmin || !hasName;
}

// Listen to admin mode changes
const observer = new MutationObserver(() => {
    updateRegisterButtonState();
});
observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

// Model loading + camera helpers
async function loadModels() {
    // display loading badge
    statusBadge.classList.remove('awaiting');
    statusBadge.classList.add('loading');
    statusBadge.textContent = 'Loading models...';

    const LOCAL_MODEL_URL = './models'; // explicit relative path works with file:// and http
    const CDN_MODEL_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';

    console.log('Attempting to load models from local directory', LOCAL_MODEL_URL);

    // helper which tries local first, then CDN if local fails
    async function loadWithFallback(name, loaderFn) {
        try {
            console.log(`loading ${name} from local`);
            await loaderFn(LOCAL_MODEL_URL);
            console.log(`${name} loaded from local`);
        } catch (localErr) {
            console.warn(`${name} local load failed, falling back to CDN`, localErr);
            try {
                console.log(`loading ${name} from CDN`);
                await loaderFn(CDN_MODEL_URL);
                console.log(`${name} loaded from CDN`);
            } catch (cdnErr) {
                console.error(`${name} CDN load also failed`, cdnErr);
                throw cdnErr; // propagate error
            }
        }
    }

    try {
        await loadWithFallback('ssdMobilenetv1', url => faceapi.nets.ssdMobilenetv1.loadFromUri(url));
        await loadWithFallback('faceLandmark68Net', url => faceapi.nets.faceLandmark68Net.loadFromUri(url));
        await loadWithFallback('faceRecognitionNet', url => faceapi.nets.faceRecognitionNet.loadFromUri(url));

        statusBadge.classList.remove('loading');
        statusBadge.classList.add('ready');
        statusBadge.textContent = 'Models loaded';

        // After models are ready, evaluate the active class (respects timetable)
        if (loggedInUser) {
            evaluateActiveClass();
        }

        // restore any saved data after camera ready
        loadFacesFromStorage();
        loadLogFromStorage();

    } catch (err) {
        console.error('Error loading models', err);
        statusBadge.classList.remove('loading');
        statusBadge.classList.add('error');
        statusBadge.textContent = 'Failed to load models';
        alert('Could not load face recognition models. Check console for details.');
    }
}

async function initCamera() {
    try {
        console.log('🔄 Requesting camera access...');

        // Check if mediaDevices is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Camera API not supported in this browser');
        }

        const constraints = {
            video: {
                width: { ideal: 1280, min: 640 },
                height: { ideal: 720, min: 480 },
                facingMode: 'user' // Use front camera if available
            },
            audio: false
        };

        console.log('📹 Camera constraints:', constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('✅ Camera access granted successfully');

        video.srcObject = stream;
        video.onloadedmetadata = () => {
            console.log('🎥 Video metadata loaded - starting playback');
            video.play();
            videoLoader.classList.add('hidden');
            setupCanvas();
            detectFrame();
        };

        // Handle stream errors
        stream.getVideoTracks()[0].onended = () => {
            console.error('❌ Camera stream ended unexpectedly');
            alert('Camera stream was interrupted. Please refresh the page.');
        };

    } catch (err) {
        console.error('❌ Camera initialization failed:', err);
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);

        // Provide user-friendly error messages
        let errorMsg = 'Unable to access the camera.';
        let detailedMsg = '';

        if (err.name === 'NotAllowedError') {
            errorMsg = 'Camera permission denied.';
            detailedMsg = 'Please:\n1. Click "Allow" when prompted for camera access\n2. Check your browser privacy settings\n3. Make sure no other app is using the camera';
        } else if (err.name === 'NotFoundError') {
            errorMsg = 'No camera device found.';
            detailedMsg = 'Please:\n1. Connect a camera/webcam\n2. Check device manager for camera drivers\n3. Try refreshing the page';
        } else if (err.name === 'NotReadableError') {
            errorMsg = 'Camera is in use by another application.';
            detailedMsg = 'Please:\n1. Close other apps using the camera (Zoom, Teams, etc.)\n2. Restart your computer\n3. Try a different camera';
        } else if (err.name === 'OverconstrainedError') {
            errorMsg = 'Camera does not support required resolution.';
            detailedMsg = 'The camera may be too old or have compatibility issues.';
        } else if (err.name === 'SecurityError') {
            errorMsg = 'Camera access blocked by security settings.';
            detailedMsg = 'Please check your browser security settings and try running as administrator.';
        }

        alert(`${errorMsg}\n\n${detailedMsg}`);
        statusBadge.textContent = 'Camera Error';
        statusBadge.classList.add('error');

        // Try to request permission again after a delay
        setTimeout(() => {
            if (confirm('Would you like to try accessing the camera again?')) {
                initCamera();
            }
        }, 2000);
    }
}

function setupCanvas() {
    // create a face-api canvas overlay and size it to video
    canvas = faceapi.createCanvasFromMedia(video);
    video.parentElement.appendChild(canvas);
    displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);
}

// Improved face detection with better parameters
async function detectFrame() {
    if (!isRecognizing) {
        setTimeout(detectFrame, 200);
        return;
    }
    // Do not mark attendance if no active class is set (faculty outside schedule)
    if (!currentClass && loggedInUser && loggedInUser.role === 'faculty') {
        setTimeout(detectFrame, 500);
        return;
    }

    try {
        // Enhanced face detection with better parameters
        const detections = await faceapi.detectAllFaces(video, new faceapi.SsdMobilenetv1Options({
            minConfidence: 0.6, // Higher confidence threshold
            maxResults: 5 // Limit to 5 faces max
        }))
            .withFaceLandmarks()
            .withFaceDescriptors();

        // Resize boxes to match visual canvas
        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        // Clear previous frame drawing
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

        if (faceMatcher && resizedDetections.length > 0) {
            // Find best match for each face
            const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));

            results.forEach((result, i) => {
                const box = resizedDetections[i].detection.box;

                // Enhanced attendance marking logic
                if (result.label !== 'unknown') {
                    const distance = result.distance;
                    const confidence = 1 - distance; // Convert distance to confidence score

                    // More lenient threshold for better recognition
                    if (distance < 0.6) {
                        // Check if we haven't marked this person recently (prevent spam)
                        const now = Date.now();
                        const lastMark = lastAttendanceMark.get(result.label) || 0;
                        const timeSinceLastMark = now - lastMark;

                        // Only mark if it's been more than 5 seconds since last mark
                        if (timeSinceLastMark > 5000) {
                            markAttendance(result.label, confidence);
                            lastAttendanceMark.set(result.label, now);

                            // Visual feedback for successful recognition
                            showRecognitionFeedback(result.label, confidence);
                        }
                    }
                }

                // Enhanced visual feedback
                const distance = result.distance;
                let label = result.label;
                let boxColor = '#ef4444'; // Red for unknown

                if (result.label !== 'unknown') {
                    const confidence = 1 - distance;
                    if (distance < 0.6) {
                        boxColor = '#10b981'; // Green for recognized
                        label = `${result.label} (${(confidence * 100).toFixed(0)}%)`;
                    } else {
                        boxColor = '#f59e0b'; // Orange for low confidence
                        label = `${result.label} (Low: ${(confidence * 100).toFixed(0)}%)`;
                    }
                }

                // Draw Box with enhanced styling
                const drawBox = new faceapi.draw.DrawBox(box, {
                    label: label,
                    boxColor: boxColor,
                    lineWidth: 3
                });
                drawBox.draw(canvas);
            });
        } else {
            // Just draw standard face boxes if no matches registered yet
            faceapi.draw.drawDetections(canvas, resizedDetections);
        }
    } catch (err) {
        console.error('Face detection error:', err);
    }

    // Optimized frame rate - faster for better responsiveness
    setTimeout(detectFrame, 150);
}

// Registration and button listeners are set up inside DOMContentLoaded above

// 5. Enhanced Attendance Logging Logic
function markAttendance(name, confidence = null) {
    // SECURITY/CONSISTENCY CHECK: If a class is active, verify student belongs to this class's filter
    if (activeTimetableEntry) {
        const meta = studentMetadata.get(name);
        if (!meta) return;

        const classCourse = activeTimetableEntry.course;
        const classSec = activeTimetableEntry.section;
        const classSpec = activeTimetableEntry.specialization || 'All';

        if (meta.course !== classCourse) return;
        if (meta.section !== classSec) return;
        if (classSpec !== 'All' && meta.specialization !== classSpec) return;
    }

    if (attendanceLog.has(name)) {
        return; // Already marked present today
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Store attendance with confidence if provided
    const attendanceData = {
        time: timeStr,
        confidence: confidence ? (confidence * 100).toFixed(1) + '%' : null,
        timestamp: now.getTime()
    };

    attendanceLog.set(name, attendanceData);

    // Update active session attendance history
    if (activeTimetableEntry) {
        const sessionId = `${new Date().toDateString()} | ${activeTimetableEntry.id}`;
        if (!attendanceHistory.studentAttendance[name]) {
            attendanceHistory.studentAttendance[name] = [];
        }
        if (!attendanceHistory.studentAttendance[name].includes(sessionId)) {
            attendanceHistory.studentAttendance[name].push(sessionId);
            saveHistoryToStorage();
        }
    }

    // Save Log to Storage
    saveLogToStorage();

    // Update UI Table
    updateAttendanceTable();

    // Show success feedback
    showFeedback(`✓ Attendance marked for ${name}`, 'success');
}

// Visual feedback for successful face recognition
function showRecognitionFeedback(name, confidence) {
    // Create a temporary notification overlay
    const notification = document.createElement('div');
    notification.className = 'recognition-notification';
    notification.innerHTML = `
        <div class="recognition-content">
            <div class="recognition-icon">✓</div>
            <div class="recognition-text">
                <div class="recognition-name">${name}</div>
                <div class="recognition-confidence">${(confidence * 100).toFixed(0)}% match</div>
            </div>
        </div>
    `;

    // Add to video container temporarily
    const vc = document.querySelector('.video-container');
    if (!vc) return;
    vc.appendChild(notification);

    // Remove after 2 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 2000);
}

function updateAttendanceTable() {
    attendanceBody.innerHTML = '';

    if (labeledFaceDescriptors.length === 0) {
        attendanceBody.innerHTML = '<tr class="empty-state"><td colspan="3">No students registered yet.</td></tr>';
        presentCount.textContent = '0 / 0 Present';
        return;
    }

    let present = 0;

    // Filter students by active class context
    let filteredStudents = labeledFaceDescriptors.map(f => f.label);
    
    if (activeTimetableEntry && (loggedInUser.role === 'faculty' || loggedInUser.role === 'admin' || loggedInUser.role === 'super')) {
        const classCourse = activeTimetableEntry.course;
        const classSec = activeTimetableEntry.section;
        const classSpec = activeTimetableEntry.specialization || 'All';

        filteredStudents = filteredStudents.filter(name => {
            const meta = studentMetadata.get(name);
            if (!meta) return false;
            
            // Must match course and section
            if (meta.course !== classCourse) return false;
            if (meta.section !== classSec) return false;
            
            // If specialization is set, must match it too
            if (classSpec !== 'All' && meta.specialization !== classSpec) return false;
            
            return true;
        });
    }

    // Sort students alphabetically
    filteredStudents.sort((a,b) => a.localeCompare(b));

    filteredStudents.forEach(name => {
        const tr = document.createElement('tr');
        if (attendanceLog.has(name)) {
            const meta = studentMetadata.get(name) || { course: '?', section: '?', specialization: '?' };
            const courseSecInfo = `<div style="font-size:0.75rem; color:var(--text-muted);">${meta.course}</div><div>Sec ${meta.section} ${meta.specialization !== 'None' ? `(${meta.specialization})` : ''}</div>`;

            tr.innerHTML = `
                <td><strong>${name}</strong></td>
                <td>${courseSecInfo}</td>
                <td>${time} ${confidence ? `<br><small>(${confidence})</small>` : ''}</td>
                <td><span class="status-badge" style="background:#10b981;color:white;padding:4px 8px;border-radius:12px;font-size:0.8rem;">Present</span></td>
            `;
            present++;
            attendanceBody.insertBefore(tr, attendanceBody.firstChild); // Present at top
        } else {
            const meta = studentMetadata.get(name) || { course: '?', section: '?', specialization: '?' };
            const courseSecInfo = `<div style="font-size:0.75rem; color:var(--text-muted);">${meta.course}</div><div>Sec ${meta.section} ${meta.specialization !== 'None' ? `(${meta.specialization})` : ''}</div>`;

            tr.innerHTML = `
                <td><strong>${name}</strong></td>
                <td>${courseSecInfo}</td>
                <td>--</td>
                <td><span class="status-badge absent" style="background:#ef4444;color:white;padding:4px 8px;border-radius:12px;font-size:0.8rem;">Absent</span></td>
            `;
            attendanceBody.appendChild(tr); // Absent at bottom
        }
    });

    presentCount.textContent = `${present} / ${filteredStudents.length} Present`;
}

// Helper
function showFeedback(msg, type) {
    regFeedback.textContent = msg;
    regFeedback.className = `feedback ${type}`;
    setTimeout(() => { if(regFeedback.textContent === msg) regFeedback.textContent = ''; }, 4000);
}



function saveFacesToStorage() {
    const dataToSave = labeledFaceDescriptors.map(lfd => {
        const meta = studentMetadata.get(lfd.label) || { section: 'Unknown', specialization: 'None' };
        return {
            label: lfd.label,
            course: meta.course,
            section: meta.section,
            specialization: meta.specialization,
            password: meta.password,
            descriptors: lfd.descriptors.map(d => Array.from(d))
        };
    });
    localStorage.setItem(FACES_KEY, JSON.stringify(dataToSave));
}

function loadFacesFromStorage() {
    const saved = localStorage.getItem(FACES_KEY);
    if (!saved) return;
    
    try {
        const parsed = JSON.parse(saved);
        studentMetadata = new Map();
        labeledFaceDescriptors = parsed.map(item => {
            const descriptors = item.descriptors.map(d => new Float32Array(d));
            
            // Load metadata (with fallback for legacy data)
            studentMetadata.set(item.label, {
                course: item.course || 'B.Tech CSE',
                section: item.section || 'A',
                specialization: item.specialization || 'None',
                password: item.password || 'student'
            });

            return new faceapi.LabeledFaceDescriptors(item.label, descriptors);
        });
        
        if (labeledFaceDescriptors.length > 0) {
            faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.6);
        }
        updateAttendanceTable();
    } catch(e) { console.error('Error loading faces', e); }
}

function saveLogToStorage() {
    const logsByClassObj = {};
    allAttendanceLogs.forEach((classMap, className) => {
        const logObj = {};
        classMap.forEach((value, key) => {
            logObj[key] = value;
        });
        logsByClassObj[className] = logObj;
    });

    localStorage.setItem(LOG_KEY, JSON.stringify({
        date: new Date().toDateString(),
        logsByClass: logsByClassObj
    }));
}

function loadLogFromStorage() {
    const saved = localStorage.getItem(LOG_KEY);
    if (!saved) return;

    try {
        const parsed = JSON.parse(saved);
        // Only load if it's the exact same day
        if (parsed.date === new Date().toDateString()) {
            allAttendanceLogs = new Map();
            if (parsed.logsByClass) {
                // New format
                Object.entries(parsed.logsByClass).forEach(([className, logData]) => {
                    const classMap = new Map();
                    Object.entries(logData).forEach(([name, data]) => {
                        classMap.set(name, data);
                    });
                    allAttendanceLogs.set(className, classMap);
                });
            } else if (parsed.log) {
                // Legacy format migration
                const defaultClassMap = new Map();
                Object.entries(parsed.log).forEach(([name, data]) => {
                    defaultClassMap.set(name, data);
                });
                allAttendanceLogs.set('Lecture 1', defaultClassMap);
            }
            
            // Re-point attendanceLog map
            if (!allAttendanceLogs.has(currentClass)) {
                allAttendanceLogs.set(currentClass, new Map());
            }
            attendanceLog = allAttendanceLogs.get(currentClass);
        } else {
            allAttendanceLogs = new Map(); // Fresh day!
            attendanceLog = new Map();
            allAttendanceLogs.set(currentClass, attendanceLog);
        }
        updateAttendanceTable();
    } catch(e) { console.error('Error loading log', e); }
}

function loadHistoryFromStorage() {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
        try {
            attendanceHistory = JSON.parse(saved);
        } catch(e) { console.error('Error loading history', e); }
    }
}

function saveHistoryToStorage() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(attendanceHistory));
}

function renderStudentDashboard(name) {
    const meta = studentMetadata.get(name) || { course: 'Unknown', section: 'Unknown', specialization: 'None' };
    
    const welcomeEl = document.getElementById('studentWelcome');
    const infoEl = document.getElementById('studentInfo');
    if (welcomeEl) welcomeEl.textContent = `Welcome, ${name}`;
    if (infoEl) infoEl.textContent = `Course: ${meta.course} | Section: ${meta.section} | Specialization: ${meta.specialization}`;
    
    // Calculate totals
    const totalSessions = attendanceHistory.sessions.filter(s => {
        if (s.course !== meta.course) return false;
        if (s.section !== meta.section) return false;
        if (s.specialization !== 'All' && s.specialization !== meta.specialization) return false;
        return true;
    });

    const studentAttended = attendanceHistory.studentAttendance[name] || [];
    let attendedCount = 0;
    
    totalSessions.forEach(s => {
        if (studentAttended.includes(s.id)) {
            attendedCount++;
        }
    });

    const totalClasses = totalSessions.length;
    const percentage = totalClasses === 0 ? 0 : Math.round((attendedCount / totalClasses) * 100);

    const totalEl = document.getElementById('studentTotalClasses');
    const attendEl = document.getElementById('studentAttendedClasses');
    const percEl = document.getElementById('studentPercentage');
    
    if (totalEl) totalEl.textContent = totalClasses;
    if (attendEl) attendEl.textContent = attendedCount;
    if (percEl) percEl.textContent = `${percentage}%`;
}

// All event listeners are set up inside DOMContentLoaded above

