/**
 * Kunlik Reja va Bildirishnomalar Tizimi - Asosiy Dastur Logikasi
 */

// Davlat (State)
let tasks = [];
let activeFilter = 'all';
let activeCategory = 'all';
let searchQuery = '';
let alarmInterval = null;
let currentActiveAlarmTask = null;
let originalTitle = document.title;
let titleBlinkInterval = null;

// ==========================================
// 1. Dasturni Ishga Tushirish (Initialization)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadTasks();
    initServiceWorker();
    checkNotificationPermission();
    setupEventListeners();
    startClockAndScheduler();
    renderTasks();
    updateStats();
    initSettingsUI();

    // Brauzer audio kontekstini birinchi foydalanuvchi bosishida faollashtirish
    const unlockAudio = () => {
        soundEngine.initContext();
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
});

// ==========================================
// 2. Service Worker & Bildirishnoma API
// ==========================================
function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then((reg) => {
            console.log('Service Worker muvaffaqiyatli ro\'yxatdan o\'tdi:', reg.scope);
        }).catch((err) => {
            console.warn('Service Worker ro\'yxatdan o\'tishida ogohlantirish:', err);
        });

        // SW dan keladigan xabarlarni tinglash
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'NOTIFICATION_ACTION') {
                const { action, taskId } = event.data;
                const task = tasks.find(t => t.id === taskId);
                if (!task) return;

                if (action === 'complete') {
                    toggleTaskComplete(taskId);
                } else if (action === 'snooze') {
                    snoozeTask(taskId, 5);
                }
            }
        });
    }
}

function checkNotificationPermission() {
    const banner = document.getElementById('notifBanner');
    const bannerTitle = document.getElementById('bannerTitle');
    const bannerDesc = document.getElementById('bannerDesc');
    const bannerIcon = document.getElementById('bannerIcon');
    const requestBtn = document.getElementById('requestNotifBtn');

    if (!('Notification' in window)) {
        banner.style.display = 'none';
        return;
    }

    if (Notification.permission === 'granted') {
        banner.classList.add('granted');
        bannerIcon.textContent = '✅';
        bannerTitle.textContent = 'Bildirishnomalar faollashtirilgan';
        bannerDesc.textContent = 'Barcha kunlik va rejali vazifalar belgilangan vaqtda o\'zgacha ovoz bilan yangraydi.';
        requestBtn.textContent = 'Ovozni sinash';
        requestBtn.onclick = () => {
            soundEngine.play();
            showNativeNotification({
                title: '🔔 Sinov bildirishnomasi',
                body: 'Sizning bildirishnomalaringiz va maxsus ovozingiz a\'lo darajada ishlamoqda!'
            });
        };
    } else if (Notification.permission === 'denied') {
        banner.classList.remove('granted');
        bannerIcon.textContent = '⚠️';
        bannerTitle.textContent = 'Bildirishnomalar bloklangan';
        bannerDesc.textContent = 'Brauzer qidiruv satridagi qulf (sozlama) belgisini bosib, bildirishnomalarga ruxsat bering.';
        requestBtn.textContent = 'Qanday ochish?';
        requestBtn.onclick = () => {
            alert('Bildirishnomalarni yoqish uchun:\n1. Brauzer manzillar satridagi (URL yonidagi) "qulf" yoki "sozlama" belgisini bosing.\n2. "Bildirishnomalar" (Notifications) ga "Ruxsat berish" (Allow) ni tanlang va sahifani yangilang.');
        };
    } else {
        banner.classList.remove('granted');
        bannerIcon.textContent = '🔔';
        bannerTitle.textContent = 'Eslatmalar o\'z vaqtida kelishi uchun ruxsat bering';
        bannerDesc.textContent = 'Sayt fonda turganda yoki boshqa ilovada bo\'lsangiz ham maxsus tovushli bildirishnoma keladi.';
        requestBtn.textContent = 'Ruxsat berish';
        requestBtn.onclick = requestNotificationPermission;
    }
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        alert('Kechirasiz, ushbu brauzer bildirishnomalarni qo\'llab-quvvatlamaydi.');
        return;
    }

    try {
        soundEngine.initContext();
        const permission = await Notification.requestPermission();
        checkNotificationPermission();
        if (permission === 'granted') {
            soundEngine.play();
            showNativeNotification({
                title: '🔔 Ruxsat berildi!',
                body: 'Ajoyib! Endi har bir kunlik vazifangiz o\'z vaqtida maxsus ohang bilan eslatiladi.'
            });
        }
    } catch (e) {
        console.error('Ruxsat so\'rashda xatolik:', e);
    }
}

function showNativeNotification(taskOrInfo) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const title = taskOrInfo.title.startsWith('🔔') ? taskOrInfo.title : `🔔 VAQT KELDI: ${taskOrInfo.title}`;
    const options = {
        body: taskOrInfo.body || `${taskOrInfo.time || ''} - ${taskOrInfo.description || 'Rejalashtirilgan vazifangizni bajarish vaqti bo\'ldi!'}`,
        icon: 'icon.svg',
        badge: 'icon.svg',
        tag: 'task-reminder-' + (taskOrInfo.id || Date.now()),
        renotify: true,
        requireInteraction: true,
        data: { taskId: taskOrInfo.id },
        actions: [
            { action: 'complete', title: '✅ Bajarildi' },
            { action: 'snooze', title: '⏱️ 5 daqiqa surish' }
        ]
    };

    try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(reg => {
                reg.showNotification(title, options);
            });
        } else {
            new Notification(title, options);
        }
    } catch (e) {
        try {
            new Notification(title, { body: options.body, icon: options.icon });
        } catch (err) {
            console.error('Bildirishnoma chiqarishda xatolik:', err);
        }
    }
}

// ==========================================
// 3. Soat va Vaqt Nazorati (Scheduler Ticker)
// ==========================================
function startClockAndScheduler() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();

    // Raqamli soat
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clockTime').textContent = `${hours}:${minutes}:${seconds}`;

    // Sana o'zbek tilida
    const daysUz = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
    const monthsUz = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
    const dateStr = `${daysUz[now.getDay()]}, ${now.getDate()}-${monthsUz[now.getMonth()]} ${now.getFullYear()}`;
    document.getElementById('clockDate').textContent = dateStr;

    // Har soniyada vazifalarni tekshirish
    checkTasksAlarm(now);
}

function checkTasksAlarm(now) {
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const currentDate = String(now.getDate()).padStart(2, '0');
    const todayStr = `${currentYear}-${currentMonth}-${currentDate}`;

    const currentHours = String(now.getHours()).padStart(2, '0');
    const currentMinutes = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHours}:${currentMinutes}`;
    const currentSeconds = now.getSeconds();

    // Faqat daqiqa boshida (0-soniyada) yoki yaqin soniyalarda qayta-qayta ortiqcha takrorlanmasligi uchun
    tasks.forEach(task => {
        if (task.completed) return;

        let shouldTrigger = false;

        if (task.isDaily) {
            // Kunlik takrorlanuvchi vazifa: har kuni ko'rsatilgan vaqtda va bugun hali bildirishnoma olmagan bo'lsa
            if (task.time === currentTimeStr && task.lastNotifiedDate !== todayStr) {
                shouldTrigger = true;
                task.lastNotifiedDate = todayStr;
            }
        } else {
            // Bir martalik vazifa: aniq sana va vaqt to'g'ri kelganda
            if (task.date === todayStr && task.time === currentTimeStr && !task.notified) {
                shouldTrigger = true;
                task.notified = true;
            }
        }

        if (shouldTrigger) {
            saveTasks();
            triggerAlarm(task);
        }
    });
}

function triggerAlarm(task) {
    currentActiveAlarmTask = task;

    // 1. Maxsus Ovozni chalish (Tanlangan alohida ohang yoki tizim standarti)
    const soundToPlay = (task.sound && task.sound !== 'default') ? task.sound : soundEngine.currentSound;
    soundEngine.play(soundToPlay);

    // Agar foydalanuvchi to'xtatmaguncha ohang 3 martagacha takrorlansin
    let repeatCount = 0;
    if (alarmInterval) clearInterval(alarmInterval);
    alarmInterval = setInterval(() => {
        repeatCount++;
        if (repeatCount >= 3) {
            clearInterval(alarmInterval);
            alarmInterval = null;
        } else {
            soundEngine.play(soundToPlay);
        }
    }, 2400);

    // 2. Brauzer tizim bildirishnomasi
    showNativeNotification(task);

    // 3. Sahifa sarlavhasini miltillatish
    startTitleBlink(`🔔 [VAQT KELDI] ${task.title}`);

    // 4. Ekranda Jonli Alarm Modalini ko'rsatish
    document.getElementById('alarmTaskTitle').textContent = task.title;
    document.getElementById('alarmTaskDesc').textContent = task.description || 'Ushbu vazifani bajarish vaqti yetib keldi!';
    document.getElementById('alarmModal').classList.add('active');

    // Ro'yxatni yangilash
    renderTasks();
}

function stopAlarm() {
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    stopTitleBlink();
    document.getElementById('alarmModal').classList.remove('active');
    currentActiveAlarmTask = null;
}

function startTitleBlink(alertText) {
    stopTitleBlink();
    let isBlinked = false;
    titleBlinkInterval = setInterval(() => {
        document.title = isBlinked ? originalTitle : alertText;
        isBlinked = !isBlinked;
    }, 800);
}

function stopTitleBlink() {
    if (titleBlinkInterval) {
        clearInterval(titleBlinkInterval);
        titleBlinkInterval = null;
    }
    document.title = originalTitle;
}

// ==========================================
// 4. Vazifalar Boshqaruvi (CRUD & Storage)
// ==========================================
function loadTasks() {
    const saved = localStorage.getItem('todo_tasks_data');
    if (saved) {
        try {
            tasks = JSON.parse(saved);
        } catch (e) {
            tasks = [];
        }
    }

    // Agar birinchi marta kirilgan bo'lsa namunaviy vazifalarni yuklash
    if (!tasks || tasks.length === 0) {
        const today = getTodayDateStr();
        const now = new Date();
        const nextHour = new Date(now.getTime() + 15 * 60000);
        const time1 = `${String(nextHour.getHours()).padStart(2, '0')}:${String(nextHour.getMinutes()).padStart(2, '0')}`;

        tasks = [
            {
                id: 'sample-1',
                title: 'Kunlik muhim rejalarni tekshirish',
                description: 'Bugungi qilinishi kerak bo\'lgan eng asosiy 3 ta ishni belgilab olish',
                date: today,
                time: time1,
                isDaily: true,
                category: 'odat',
                priority: 'high',
                sound: 'cosmic',
                completed: false,
                notified: false,
                lastNotifiedDate: null,
                createdAt: new Date().toISOString()
            },
            {
                id: 'sample-2',
                title: 'Toza suv ichish va ko\'z mashqlari',
                description: 'Ekranga uzoq qarashdan so\'ng 5 daqiqa tanaffus qilish',
                date: today,
                time: '15:00',
                isDaily: true,
                category: 'soglik',
                priority: 'medium',
                sound: 'zen',
                completed: false,
                notified: false,
                lastNotifiedDate: null,
                createdAt: new Date().toISOString()
            },
            {
                id: 'sample-3',
                title: 'Bugungi hisobotni yakunlash',
                description: 'Barcha ishlarni tizimga kiritib, rahbariyatga xabar berish',
                date: today,
                time: '18:00',
                isDaily: false,
                category: 'ish',
                priority: 'high',
                sound: 'urgent',
                completed: false,
                notified: false,
                lastNotifiedDate: null,
                createdAt: new Date().toISOString()
            }
        ];
        saveTasks();
    }
}

function saveTasks() {
    localStorage.setItem('todo_tasks_data', JSON.stringify(tasks));
    updateStats();
}

function getTodayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCurrentTimeStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Vazifani saqlash (Yangi yoki tahrirlangan)
function handleSaveTask(e) {
    e.preventDefault();

    const editId = document.getElementById('editTaskId').value;
    const title = document.getElementById('taskInputTitle').value.trim();
    const desc = document.getElementById('taskInputDesc').value.trim();
    const date = document.getElementById('taskInputDate').value;
    const time = document.getElementById('taskInputTime').value;
    const isDaily = document.getElementById('taskInputDaily').checked;
    const category = document.getElementById('taskInputCategory').value;
    const priority = document.getElementById('taskInputPriority').value;
    const sound = document.getElementById('taskInputSound').value;

    if (!title || !date || !time) {
        alert('Iltimos, vazifa nomi, sana va vaqtini to\'ldiring!');
        return;
    }

    if (editId) {
        // Tahrirlash
        const index = tasks.findIndex(t => t.id === editId);
        if (index !== -1) {
            tasks[index] = {
                ...tasks[index],
                title,
                description: desc,
                date,
                time,
                isDaily,
                category,
                priority,
                sound,
                notified: false // Vaqti o'zgargan bo'lsa qayta ogohlantirishi uchun
            };
        }
    } else {
        // Yangi vazifa
        const newTask = {
            id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            title,
            description: desc,
            date,
            time,
            isDaily,
            category,
            priority,
            sound,
            completed: false,
            notified: false,
            lastNotifiedDate: null,
            createdAt: new Date().toISOString()
        };
        tasks.unshift(newTask);
    }

    saveTasks();
    closeTaskModal();
    renderTasks();

    // Foydalanuvchiga ovoz bilan tasdiqlash
    soundEngine.play(sound !== 'default' ? sound : 'marimba');
}

// Tezkor qo'shish
function handleQuickAdd(e) {
    e.preventDefault();
    const titleInput = document.getElementById('quickTitle');
    const timeInput = document.getElementById('quickTime');

    const title = titleInput.value.trim();
    if (!title) return;

    let time = timeInput.value;
    if (!time) {
        // Agar vaqt ko'rsatilmagan bo'lsa, hozirgi vaqtdan 30 daqiqa keyinga qo'yish
        const future = new Date(Date.now() + 30 * 60000);
        time = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    }

    const newTask = {
        id: 'task_' + Date.now(),
        title: title,
        description: '',
        date: getTodayDateStr(),
        time: time,
        isDaily: false,
        category: 'ish',
        priority: 'medium',
        sound: 'default',
        completed: false,
        notified: false,
        lastNotifiedDate: null,
        createdAt: new Date().toISOString()
    };

    tasks.unshift(newTask);
    saveTasks();
    titleInput.value = '';
    timeInput.value = '';
    renderTasks();

    soundEngine.play('marimba');
}

// Bajarildi holatini o'zgartirish
function toggleTaskComplete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;

    saveTasks();
    renderTasks();

    if (task.completed) {
        soundEngine.play('zen');
    }
}

// Vazifani o'chirish
function deleteTask(id) {
    if (confirm('Ushbu vazifani o\'chirishni xohlaysizmi?')) {
        tasks = tasks.filter(t => t.id === id);
        saveTasks();
        renderTasks();
    }
}

// Tahrirlash modalini ochish
function openEditModal(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('modalTitle').textContent = '✏️ Rejani Tahrirlash';
    document.getElementById('editTaskId').value = task.id;
    document.getElementById('taskInputTitle').value = task.title;
    document.getElementById('taskInputDesc').value = task.description || '';
    document.getElementById('taskInputDate').value = task.date;
    document.getElementById('taskInputTime').value = task.time;
    document.getElementById('taskInputDaily').checked = !!task.isDaily;
    document.getElementById('taskInputCategory').value = task.category || 'ish';
    document.getElementById('taskInputPriority').value = task.priority || 'medium';
    document.getElementById('taskInputSound').value = task.sound || 'default';

    document.getElementById('taskModal').classList.add('active');
}

// Vazifani 5 daqiqaga kechiktirish (Snooze)
function snoozeTask(id, minutes = 5) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const now = new Date();
    const future = new Date(now.getTime() + minutes * 60000);
    const newHours = String(future.getHours()).padStart(2, '0');
    const newMinutes = String(future.getMinutes()).padStart(2, '0');

    task.date = getTodayDateStr();
    task.time = `${newHours}:${newMinutes}`;
    task.notified = false;
    task.lastNotifiedDate = null; // Qayta chalinishi uchun

    saveTasks();
    renderTasks();
    stopAlarm();

    soundEngine.play('radar');
    alert(`⏱️ "${task.title}" vazifasi ${minutes} daqiqaga (${task.time} ga) kechiktirildi.`);
}

// ==========================================
// 5. Interfeysni Chizish (Rendering)
// ==========================================
function renderTasks() {
    const listContainer = document.getElementById('taskList');
    listContainer.innerHTML = '';

    const todayStr = getTodayDateStr();

    // Filtrlash
    const filteredTasks = tasks.filter(task => {
        // Tab filter
        if (activeFilter === 'today') {
            if (task.date !== todayStr && !task.isDaily) return false;
        } else if (activeFilter === 'daily') {
            if (!task.isDaily) return false;
        } else if (activeFilter === 'pending') {
            if (task.completed) return false;
        } else if (activeFilter === 'completed') {
            if (!task.completed) return false;
        }

        // Kategoriya filter
        if (activeCategory !== 'all' && task.category !== activeCategory) {
            return false;
        }

        // Qidiruv filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const matchTitle = task.title.toLowerCase().includes(query);
            const matchDesc = (task.description || '').toLowerCase().includes(query);
            if (!matchTitle && !matchDesc) return false;
        }

        return true;
    });

    if (filteredTasks.length === 0) {
        listContainer.innerHTML = `
            <div class="task-empty">
                <div class="task-empty-icon">📭</div>
                <h3>Hech qanday vazifa topilmadi</h3>
                <p>Yangi vazifa qo'shish uchun yuqoridagi maydondan foydalaning!</p>
            </div>
        `;
        return;
    }

    // Saralash: Bajarilmaganlar oldinda, keyin vaqti bo'yicha
    filteredTasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (a.time || '').localeCompare(b.time || '');
    });

    filteredTasks.forEach(task => {
        const card = createTaskCardElement(task);
        listContainer.appendChild(card);
    });
}

function createTaskCardElement(task) {
    const card = document.createElement('div');
    card.className = `task-card priority-${task.priority} ${task.completed ? 'completed' : ''}`;

    // Kategoriya nomlari va belgilari
    const catMap = {
        ish: '💼 Ish',
        shaxsiy: '🏠 Shaxsiy',
        oqish: '📚 O\'qish',
        soglik: '🏃 Sog\'lik',
        odat: '⭐ Odat'
    };

    // Ohang nomi
    const soundMap = {
        default: 'Standart',
        cosmic: '✨ Kristal',
        zen: '🧘 Zen',
        cyber: '⚡ Kiber',
        marimba: '🎵 Marimba',
        radar: '📡 Radar',
        urgent: '🚨 Shoshilinch'
    };

    // Qolgan vaqt / Muddat hisobi
    const timeStatus = getTimeRemainingText(task);

    card.innerHTML = `
        <div class="task-check-wrap">
            <div class="custom-checkbox ${task.completed ? 'checked' : ''}" onclick="toggleTaskComplete('${task.id}')" title="${task.completed ? 'Bajarilmagan qilish' : 'Bajarildi deb belgilash'}">
                ${task.completed ? '✓' : ''}
            </div>
        </div>

        <div class="task-body">
            <div class="task-header-row">
                <h3 class="task-title">${escapeHtml(task.title)}</h3>
                <div class="task-badges">
                    ${task.isDaily ? '<span class="badge badge-daily">⭐ Har kuni</span>' : ''}
                    <span class="badge badge-category">${catMap[task.category] || 'Umumiy'}</span>
                    <span class="badge badge-priority-${task.priority}">
                        ${task.priority === 'high' ? '🔴 Shoshilinch' : task.priority === 'medium' ? '🟡 O\'rtacha' : '🟢 Oddiy'}
                    </span>
                </div>
            </div>

            ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}

            <div class="task-meta">
                <span class="task-time-badge ${timeStatus.isOverdue && !task.completed ? 'overdue' : ''}">
                    ⏰ ${task.time} ${task.isDaily ? '(kunlik)' : `(${task.date})`} • ${timeStatus.text}
                </span>
                <span class="task-sound-badge" title="Tanlangan ohang">
                    🔊 ${soundMap[task.sound] || 'Standart'}
                </span>
            </div>
        </div>

        <div class="task-actions">
            ${!task.completed ? `
                <button class="btn-task-action snooze" onclick="snoozeTask('${task.id}', 5)" title="5 daqiqa surish">
                    ⏱️
                </button>
            ` : ''}
            <button class="btn-task-action" onclick="openEditModal('${task.id}')" title="Tahrirlash">
                ✏️
            </button>
            <button class="btn-task-action delete" onclick="deleteTask('${task.id}')" title="O'chirish">
                🗑️
            </button>
        </div>
    `;

    return card;
}

function getTimeRemainingText(task) {
    if (task.completed) {
        return { text: 'Bajarilgan', isOverdue: false };
    }

    const now = new Date();
    const taskDateParts = (task.date || getTodayDateStr()).split('-');
    const taskTimeParts = (task.time || '00:00').split(':');

    // Agar kunlik vazifa bo'lsa, bugungi kunga hisoblash
    const targetDate = new Date(
        task.isDaily ? now.getFullYear() : parseInt(taskDateParts[0]),
        task.isDaily ? now.getMonth() : parseInt(taskDateParts[1]) - 1,
        task.isDaily ? now.getDate() : parseInt(taskDateParts[2]),
        parseInt(taskTimeParts[0]),
        parseInt(taskTimeParts[1]),
        0
    );

    const diffMs = targetDate.getTime() - now.getTime();
    const diffMinutes = Math.round(diffMs / 60000);

    if (diffMinutes < -1) {
        return { text: `${Math.abs(diffMinutes)} daqiqa o'tdi`, isOverdue: true };
    } else if (diffMinutes >= -1 && diffMinutes <= 1) {
        return { text: 'Hozirgi vaqt!', isOverdue: false };
    } else if (diffMinutes < 60) {
        return { text: `${diffMinutes} daqiqadan so'ng`, isOverdue: false };
    } else {
        const hours = Math.floor(diffMinutes / 60);
        const remMin = diffMinutes % 60;
        return { text: `${hours} soat ${remMin} daq. so'ng`, isOverdue: false };
    }
}

// ==========================================
// 6. Statistika va Ko'rsatkichlar
// ==========================================
function updateStats() {
    const todayStr = getTodayDateStr();

    const todayTasks = tasks.filter(t => t.date === todayStr || t.isDaily);
    const total = tasks.length;
    const todayCount = todayTasks.length;
    const doneToday = todayTasks.filter(t => t.completed).length;
    const pendingToday = todayCount - doneToday;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statToday').textContent = todayCount;
    document.getElementById('statDone').textContent = doneToday;
    document.getElementById('statPending').textContent = pendingToday;

    // Progress bar
    const percent = todayCount > 0 ? Math.round((doneToday / todayCount) * 100) : 0;
    document.getElementById('progressPercent').textContent = `${percent}%`;
    document.getElementById('progressFill').style.width = `${percent}%`;
}

// ==========================================
// 7. Hodisalar Tinglovchilari (Event Listeners)
// ==========================================
function setupEventListeners() {
    // Tezkor qo'shish formasi
    document.getElementById('quickAddForm').addEventListener('submit', handleQuickAdd);

    // Katta modal ochish
    document.getElementById('openAddModalBtn').addEventListener('click', () => {
        document.getElementById('modalTitle').textContent = '➕ Yangi Reja Qo\'shish';
        document.getElementById('taskForm').reset();
        document.getElementById('editTaskId').value = '';
        document.getElementById('taskInputDate').value = getTodayDateStr();

        // 30 daqiqa keyingi vaqtni default qilib qo'yish
        const future = new Date(Date.now() + 30 * 60000);
        document.getElementById('taskInputTime').value = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
        document.getElementById('taskModal').classList.add('active');
    });

    // Modalni yopish tugmalari
    document.getElementById('closeTaskModal').addEventListener('click', closeTaskModal);
    document.getElementById('cancelTaskModal').addEventListener('click', closeTaskModal);
    document.getElementById('taskForm').addEventListener('submit', handleSaveTask);

    // Modal ichida tanlangan tovushni tinglash
    document.getElementById('previewTaskSoundBtn').addEventListener('click', () => {
        const sound = document.getElementById('taskInputSound').value;
        soundEngine.play(sound !== 'default' ? sound : soundEngine.currentSound);
    });

    // Tezkor ovoz sinash
    document.getElementById('quickTestSoundBtn').addEventListener('click', () => {
        soundEngine.play();
    });

    // Sozlamalar modalini ochish/yopish
    document.getElementById('settingsBtn').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.add('active');
    });
    document.getElementById('closeSettingsModal').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.remove('active');
    });
    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.remove('active');
    });

    // Alarm Modal tugmalari
    document.getElementById('alarmBtnDone').addEventListener('click', () => {
        if (currentActiveAlarmTask) {
            toggleTaskComplete(currentActiveAlarmTask.id);
        }
        stopAlarm();
    });

    document.getElementById('alarmBtnSnooze').addEventListener('click', () => {
        if (currentActiveAlarmTask) {
            snoozeTask(currentActiveAlarmTask.id, 5);
        }
        stopAlarm();
    });

    document.getElementById('alarmBtnDismiss').addEventListener('click', () => {
        stopAlarm();
    });

    // Mavzuni almashtirish (Dark / Light)
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // Filtr tablari
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activeFilter = e.currentTarget.dataset.filter;
            renderTasks();
        });
    });

    // Kategoriya filtri
    document.getElementById('categoryFilter').addEventListener('change', (e) => {
        activeCategory = e.target.value;
        renderTasks();
    });

    // Qidiruv satri
    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderTasks();
    });

    // JSON eksport / import
    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('importDataInput').addEventListener('change', importData);
}

function closeTaskModal() {
    document.getElementById('taskModal').classList.remove('active');
}

// ==========================================
// 8. Ovoz va Tizim Sozlamalari (Settings)
// ==========================================
function initSettingsUI() {
    const soundCards = document.querySelectorAll('.sound-card-item');
    const currentSound = soundEngine.currentSound;

    soundCards.forEach(card => {
        if (card.dataset.sound === currentSound) {
            card.classList.add('selected');
        }

        card.addEventListener('click', (e) => {
            if (e.target.tagName.toLowerCase() === 'button') return;
            soundCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            const soundName = card.dataset.sound;
            soundEngine.setSound(soundName);
            soundEngine.play(soundName);
        });
    });

    // Ovoz balandligi
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    volumeSlider.value = soundEngine.volume;
    volumeValue.textContent = `${Math.round(soundEngine.volume * 100)}%`;

    volumeSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        soundEngine.setVolume(val);
        volumeValue.textContent = `${Math.round(val * 100)}%`;
    });
}

// ==========================================
// 9. Mavzu (Theme: Dark / Light)
// ==========================================
function initTheme() {
    const savedTheme = localStorage.getItem('todo_theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        document.getElementById('themeToggleBtn').textContent = '☀️';
    } else {
        document.body.classList.remove('light-theme');
        document.getElementById('themeToggleBtn').textContent = '🌙';
    }
}

function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('todo_theme', isLight ? 'light' : 'dark');
    document.getElementById('themeToggleBtn').textContent = isLight ? '☀️' : '🌙';
}

// ==========================================
// 10. Ma'lumotlarni Eksport va Import Qilish
// ==========================================
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `todo_backup_${getTodayDateStr()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedTasks = JSON.parse(event.target.result);
            if (Array.isArray(importedTasks)) {
                tasks = importedTasks;
                saveTasks();
                renderTasks();
                alert('Vazifalar muvaffaqiyatli tiklandi!');
            } else {
                alert('Noto\'g\'ri fayl formati!');
            }
        } catch (err) {
            alert('Faylni o\'qishda xatolik yuz berdi!');
        }
    };
    reader.readAsText(file);
}

// Xavfsiz HTML qochirish
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

