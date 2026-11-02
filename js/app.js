document.addEventListener('DOMContentLoaded', () => {
    // --- 1. SPA Navigation Router ---
    const navButtons = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.view-section');

    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-target');

            navButtons.forEach(btn => btn.classList.remove('active'));
            sections.forEach(sec => sec.classList.remove('active'));

            button.classList.add('active');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
            }
            const dock = document.querySelector('.nav-dock-wrapper');
            if (dock) dock.classList.remove('collapsed');

            resetInactivityTimer();
        });
    });

    // --- 2. Shelly bridge: browser <-> MIT App Inventor <-> Shelly ---
    // Stable IDs agreed with the MIT App Inventor project.
    // light1 = Shelly 1PM Mini Gen 3 relay 0 (MIT Web4)
    // relay2 = Shelly 2.5 relay 0 (MIT Web5)
    // relay3 = Shelly 2.5 relay 1 (MIT Web6)
    const bridgeDevices = {
        light1: { quickKey: 'plug-1', cardId: 'device-3' }, // Shelly 1PM Mini Gen 3 -> Smart Outlet
        relay2: { quickKey: 'light-1', cardId: 'device-1' }, // Shelly 2.5 relay 0 -> Main Living Light
        relay3: { quickKey: 'light-2', cardId: 'device-2' }  // Shelly 2.5 relay 1 -> Ambient Strip
    };
    const deviceStates = { light1: null, relay2: null, relay3: null };
    let commandSequence = 0;
    let lastBridgeValue = '';
    let commandQueue = Promise.resolve();

    function updateDeviceState(deviceId, isOn) {
        const config = bridgeDevices[deviceId];
        if (!config || typeof isOn !== 'boolean') return;
        deviceStates[deviceId] = isOn;

        // Home quick toggle
        const quickBtn = document.querySelector(`.quick-toggle-item[data-device="${config.quickKey}"]`);
        if (quickBtn) {
            quickBtn.classList.toggle('active', isOn);
            quickBtn.dataset.isOn = String(isOn);
            const stateSpan = quickBtn.querySelector('.toggle-state');
            if (stateSpan) stateSpan.textContent = isOn ? 'ON' : 'OFF';
        }

        // Devices card: checkbox + status + active appearance
        const card = document.querySelector(`.device-card[data-device-id="${config.cardId}"]`);
        if (card) {
            const checkbox = card.querySelector('.dev-checkbox');
            const statusText = card.querySelector('.device-status-text');
            if (checkbox) checkbox.checked = isOn;
            card.classList.toggle('active', isOn);
            if (statusText) statusText.textContent = isOn ? 'Active • Operational' : 'Standby • Off';
        }
        if (typeof calculateTotalPower === 'function') calculateTotalPower();
    }

    function sendBridgeCommand(deviceId, action) {
        if (!bridgeDevices[deviceId] || !['on', 'off'].includes(action)) return;
        const bridge = window.AppInventor;
        if (!bridge || typeof bridge.setWebViewString !== 'function') {
            console.warn('MIT App Inventor bridge is not available. Open this page inside the MIT WebViewer to send Shelly commands.');
            return;
        }
        const message = {
            type: 'command',
            device: deviceId,
            action,
            seq: ++commandSequence
        };
        try {
            bridge.setWebViewString(JSON.stringify(message));
        } catch (error) {
            console.error('Unable to send command to MIT App Inventor:', error);
        }
    }

    // Serialize group commands so the single WebViewString bridge is not overwritten.
    function queueGroupCommands(action) {
        const ids = ['light1', 'relay2', 'relay3'];
        ids.forEach((id, index) => {
            commandQueue = commandQueue.then(() => new Promise(resolve => {
                sendBridgeCommand(id, action);
                setTimeout(resolve, index === ids.length - 1 ? 0 : 450);
            }));
        });
    }

    // Receive MIT -> page status messages. MIT currently sends one JSON state
    // per relay; polling the shared WebViewString slot catches each update.
    function readMITBridge() {
        const bridge = window.AppInventor;
        if (!bridge || typeof bridge.getWebViewString !== 'function') return;
        try {
            const raw = bridge.getWebViewString();
            if (typeof raw !== 'string' || !raw || raw === lastBridgeValue) return;
            lastBridgeValue = raw;
            const message = JSON.parse(raw);
            if (message.type !== 'state') return;
            // Preferred format: one atomic snapshot for all three relays.
            let receivedAnyState = false;
            ['light1', 'relay2', 'relay3'].forEach(id => {
                if (typeof message[id] === 'boolean') {
                    updateDeviceState(id, message[id]);
                    receivedAnyState = true;
                }
            });
            // Backward compatibility with the current MIT blocks (one relay per message).
            if (!receivedAnyState && typeof message.device === 'string' && typeof message.ison === 'boolean') {
                updateDeviceState(message.device, message.ison);
            }
        } catch (error) {
            // Ignore empty/non-JSON bridge values; the next state poll will retry.
        }
    }
    // The MIT WebViewer exposes changes from blocks through a shared string slot.
    setInterval(readMITBridge, 150);
    readMITBridge();

    // Home quick toggles
    document.querySelectorAll('.quick-toggle-item').forEach(button => {
        const key = button.getAttribute('data-device');
        const id = Object.keys(bridgeDevices).find(deviceId => bridgeDevices[deviceId].quickKey === key);
        if (!id) return;
        button.dataset.isOn = String(button.classList.contains('active'));
        button.addEventListener('click', () => {
            const current = deviceStates[id] === null ? button.dataset.isOn === 'true' : deviceStates[id];
            sendBridgeCommand(id, current ? 'off' : 'on');
        });
    });

    // Master controls: send three individually-addressed commands in sequence.
    const turnAllOn = document.getElementById('turn-all-on');
    const turnAllOff = document.getElementById('turn-all-off');
    if (turnAllOn) turnAllOn.addEventListener('click', () => queueGroupCommands('on'));
    if (turnAllOff) turnAllOff.addEventListener('click', () => queueGroupCommands('off'));

    // --- 4. Real Weather API Integration ---
    async function updateRealWeather() {
        const apiKey = 'YOUR_OPENWEATHER_API_KEY'; 
        const city = 'Erbil';
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&appid=${apiKey}`;

        try {
            const response = await fetch(url);
            if (!response.ok) return;
            const data = await response.json();
            
            const temp = Math.round(data.main.temp);
            const condition = data.weather[0].description;
            
            const tempEl = document.querySelector('.weather-temp');
            const condEl = document.querySelector('.weather-cond');
            if (tempEl) tempEl.textContent = `${temp}°C`;
            if (condEl) condEl.textContent = condition;
        } catch (error) {
            console.log("Weather API awaiting valid key.");
        }
    }
    updateRealWeather();
    setInterval(updateRealWeather, 1800000);


    // --- Music controls: responsive UI state (streaming provider hookup is separate) ---
    const playPauseBtn = document.getElementById('play-pause-btn');
    const waveform = document.getElementById('waveform-bars');
    let musicPlaying = false;
    function setMusicPlaying(playing) {
        musicPlaying = playing;
        if (playPauseBtn) playPauseBtn.textContent = playing ? 'Ⅱ' : '▶';
        if (waveform) waveform.classList.toggle('playing', playing);
    }
    if (playPauseBtn) playPauseBtn.addEventListener('click', () => setMusicPlaying(!musicPlaying));
    document.querySelectorAll('.mood-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mood-preset-btn').forEach(item => item.classList.remove('active'));
            btn.classList.add('active');
            const moodNames = { piano: 'Cinematic Piano & Solitude', violin: 'Cinematic Violin', ambient: 'Deep Oriental Ambient' };
            const title = document.getElementById('current-track-title');
            if (title) title.textContent = moodNames[btn.dataset.mood] || btn.textContent.trim();
            setMusicPlaying(false);
        });
    });
    const autoAmbientToggle = document.getElementById('auto-ambient-toggle');
    if (autoAmbientToggle) autoAmbientToggle.addEventListener('change', () => {
        autoAmbientToggle.dataset.enabled = String(autoAmbientToggle.checked);
    });
    const previousTrackBtn = document.getElementById('prev-track-btn');
    const nextTrackBtn = document.getElementById('next-track-btn');
    if (previousTrackBtn) previousTrackBtn.addEventListener('click', () => {
        const active = document.querySelector('.mood-preset-btn.active');
        const items = [...document.querySelectorAll('.mood-preset-btn')];
        if (items.length) items[(Math.max(0, items.indexOf(active) - 1) + items.length) % items.length].click();
    });
    if (nextTrackBtn) nextTrackBtn.addEventListener('click', () => {
        const items = [...document.querySelectorAll('.mood-preset-btn')];
        const active = items.indexOf(document.querySelector('.mood-preset-btn.active'));
        if (items.length) items[(active + 1) % items.length].click();
    });

    // --- 5. Zen Meditation Mode Trigger ---
    const zenTrigger = document.getElementById('zen-trigger');
    const mainViewport = document.getElementById('main-viewport');
    
    if (zenTrigger && mainViewport) {
        zenTrigger.addEventListener('click', () => {
            mainViewport.classList.toggle('zen-mode-active');
            if (mainViewport.classList.contains('zen-mode-active')) {
                zenTrigger.innerHTML = '<span class="zen-icon"><i data-lucide="moon-star"></i></span><span class="zen-text">Exit Zen Mode</span>';
                if (window.lucide) window.lucide.createIcons();
            } else {
                zenTrigger.innerHTML = '<span class="zen-icon"><i data-lucide="sparkles"></i></span><span class="zen-text">Activate Zen Meditation Mode</span>';
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }


    // --- 6. Header Particles Generator ---
    const particlesContainer = document.getElementById('header-particles');
    if (particlesContainer) {
        const particleCount = 12;
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.classList.add('particle');
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * 80 + 10}%`;
            particle.style.animationDuration = `${3 + Math.random() * 3}s`;
            particle.style.animationDelay = `${Math.random() * 3}s`;
            particlesContainer.appendChild(particle);
        }
    }


    // --- 7. Live Clock & Date Engine (AM/PM Format) ---
    function updateClockAndDate() {
        const now = new Date();
        let hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const formattedHours = String(hours).padStart(2, '0');
        const timeString = `${formattedHours}:${minutes} ${ampm}`;

        const options = { weekday: 'short', month: 'short', day: 'numeric' };
        const dateString = now.toLocaleDateString('en-US', options);

        const miniTime = document.getElementById('mini-time');
        const miniDate = document.getElementById('mini-date');
        if (miniTime) miniTime.textContent = timeString;
        if (miniDate) miniDate.textContent = dateString;
    }

    setInterval(updateClockAndDate, 1000);
    updateClockAndDate();


    // --- 8. Collapsible Navigation Bar & Auto-Hide ---
    const dockWrapper = document.querySelector('.nav-dock-wrapper');
    const toggleBtn = document.getElementById('nav-toggle');
    let inactivityTimer;

    function collapseNav() {
        if (dockWrapper && !dockWrapper.classList.contains('collapsed')) {
            dockWrapper.classList.add('collapsed');
        }
    }

    function expandNav() {
        if (dockWrapper && dockWrapper.classList.contains('collapsed')) {
            dockWrapper.classList.remove('collapsed');
        }
        resetInactivityTimer();
    }

    function resetInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(collapseNav, 5000);
    }

    if (toggleBtn && dockWrapper) {
        toggleBtn.addEventListener('click', () => {
            if (dockWrapper.classList.contains('collapsed')) {
                expandNav();
            } else {
                collapseNav();
                clearTimeout(inactivityTimer);
            }
        });
    }

    ['mousemove', 'mousedown', 'keypress', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (dockWrapper && !dockWrapper.classList.contains('collapsed')) {
                resetInactivityTimer();
            }
        });
    });

    resetInactivityTimer();


// --- 9. Synchronized Device Names & Smart Devices Logic (Devices Section) ---
    const deviceCards = document.querySelectorAll('.device-card');
    const totalPowerElement = document.getElementById('total-power');

    function calculateTotalPower() {
        let totalWatts = 0;
        deviceCards.forEach(card => {
            const checkbox = card.querySelector('.dev-checkbox');
            if (checkbox && checkbox.checked) {
                const wattage = parseFloat(card.getAttribute('data-wattage')) || 0;
                totalWatts += wattage;
            }
        });
        if (totalPowerElement) {
            totalPowerElement.textContent = `${totalWatts.toFixed(2)} W`;
        }
    }
    window.calculateTotalPower = calculateTotalPower;

    deviceCards.forEach(card => {
        const deviceId = card.getAttribute('data-device-id');
        const nameElement = card.querySelector('.editable-name');
        const checkbox = card.querySelector('.dev-checkbox');
        const statusText = card.querySelector('.device-status-text');
        const brightnessSlider = card.querySelector('.brightness-slider');
        const sliderValLabel = card.querySelector('.slider-val');
        const switchToggle = card.querySelector('.switch-toggle');

        if (nameElement) {
            const savedName = localStorage.getItem(`inf_device_name_${deviceId}`);
            if (savedName) {
                nameElement.textContent = savedName;
                syncHomeToggleName(deviceId, savedName);
            }

            nameElement.addEventListener('blur', () => {
                const newName = nameElement.textContent.trim();
                if (newName !== '') {
                    localStorage.setItem(`inf_device_name_${deviceId}`, newName);
                    syncHomeToggleName(deviceId, newName);
                }
            });

            nameElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    nameElement.blur();
                }
            });
        }

        // ربط تفاعل مفتاح التبديل بأجهزة شيلي الحقيقية أو الأجهزة الوهمية بدقة تامة
        const targetDeviceKey = ({
            'device-1': 'relay2',
            'device-2': 'relay3',
            'device-3': 'light1'
        })[deviceId];

        if (switchToggle && targetDeviceKey) {
            // للأجهزة الحقيقية (شيلي): النقر على مفتاح التبديل يرسل الأمر مباشرة مثل الرئيسية
            switchToggle.addEventListener('click', (e) => {
                e.preventDefault(); // منع السلوك الافتراضي المتضارب للـ label
                const currentState = deviceStates[targetDeviceKey] === null ? checkbox.checked : deviceStates[targetDeviceKey];
                const actionToSend = currentState ? 'off' : 'on';
                
                // إرسال الأمر للجسر البرمجي
                sendBridgeCommand(targetDeviceKey, actionToSend);
            });
        } else if (checkbox) {
            // للأجهزة الوهمية الأخرى (مثل الـ AC أو Ambient أو Wall Display)
            checkbox.addEventListener('change', () => {
                const isChecked = checkbox.checked;
                if (isChecked) {
                    card.classList.add('active');
                    if (statusText) statusText.textContent = 'Active • Operational';
                    if (card.classList.contains('cinematic-ac-card')) {
                        const tempDisplay = card.querySelector('.ac-temp-val');
                        const acWatt = card.querySelector('.ac-watt');
                        if (tempDisplay) tempDisplay.textContent = '22';
                        if (acWatt) acWatt.textContent = '850.0 W';
                        card.setAttribute('data-wattage', '850.0');
                    }
                } else {
                    card.classList.remove('active');
                    if (statusText) statusText.textContent = 'Standby • Offline';
                    if (card.classList.contains('cinematic-ac-card')) {
                        const tempDisplay = card.querySelector('.ac-temp-val');
                        const acWatt = card.querySelector('.ac-watt');
                        if (tempDisplay) tempDisplay.textContent = '0';
                        if (acWatt) acWatt.textContent = '0.0 W';
                        card.setAttribute('data-wattage', '0.00');
                    }
                }
                calculateTotalPower();
            });
        }

        if (brightnessSlider && sliderValLabel) {
            let resetTimer;
            brightnessSlider.addEventListener('input', () => {
                clearTimeout(resetTimer);
                sliderValLabel.textContent = `${brightnessSlider.value}%`;
            });

            brightnessSlider.addEventListener('change', () => {
                resetTimer = setTimeout(() => {
                    brightnessSlider.value = 90;
                    sliderValLabel.textContent = '90%';
                }, 4000);
            });
        }
    });

    function syncHomeToggleName(deviceId, newName) {
        let mappingKey = '';
        if (deviceId === 'device-1') mappingKey = 'light-1';
        if (deviceId === 'device-2') mappingKey = 'light-2';
        if (deviceId === 'device-3') mappingKey = 'plug-1';

        if (mappingKey) {
            const toggleItem = document.querySelector(`.quick-toggle-item[data-device="${mappingKey}"]`);
            if (toggleItem) {
                const nameSpan = toggleItem.querySelector('.toggle-name');
                if (nameSpan) nameSpan.textContent = newName;
            }
        }
    }

    calculateTotalPower();


    // --- 10. Security & Surveillance Logic ---
    const realCams = [
        { title: "CAM-01: Main Entrance", class: "cam-feed-1" },
        { title: "CAM-02: Perimeter Gardens", class: "cam-feed-2" },
        { title: "CAM-03: Living Lounge", class: "cam-feed-3" }
    ];
    let activeCamIdx = 0;
    const switchCamBtn = document.getElementById('switch-cam-btn');
    const camTitleText = document.getElementById('cam-title-text');
    const camViewportBox = document.getElementById('cam-viewport-box');

    if (camViewportBox) {
        camViewportBox.classList.add(realCams[0].class);
    }

    if (switchCamBtn && camTitleText && camViewportBox) {
        switchCamBtn.addEventListener('click', () => {
            camViewportBox.classList.remove(realCams[activeCamIdx].class);
            activeCamIdx = (activeCamIdx + 1) % realCams.length;
            camTitleText.textContent = realCams[activeCamIdx].title;
            camViewportBox.classList.add(realCams[activeCamIdx].class);
        });
    }

    const lockButtons = document.querySelectorAll('.lock-toggle-btn');
    lockButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('unlocked-state')) {
                btn.classList.remove('unlocked-state');
                btn.classList.add('locked-state');
                btn.textContent = 'Unlocked';
            } else {
                btn.classList.remove('locked-state');
                btn.classList.add('unlocked-state');
                btn.textContent = 'Locked';
            }
        });
    });

    const lockdownTrigger = document.getElementById('lockdown-trigger');
    const emergencyCardBox = document.getElementById('emergency-card-box');

    if (lockdownTrigger && emergencyCardBox) {
        lockdownTrigger.addEventListener('click', () => {
            emergencyCardBox.classList.toggle('lockdown-active');
            if (emergencyCardBox.classList.contains('lockdown-active')) {
                lockdownTrigger.textContent = 'LOCKDOWN ENGAGED (Deactivate)';
                lockdownTrigger.style.background = '#ff4d4d';
                lockdownTrigger.style.color = '#fff';
            } else {
                lockdownTrigger.textContent = 'Activate Lockdown';
                lockdownTrigger.style.background = 'rgba(255, 77, 77, 0.15)';
                lockdownTrigger.style.color = '#ff6b6b';
            }
        });
    }


    // --- 11. System Settings & Customization Engine ---
    const themeButtons = document.querySelectorAll('.theme-select-btn');
    const blurButtons = document.querySelectorAll('.blur-preset-btn');
    const accentColorButtons = document.querySelectorAll('.accent-color-btn');

    const savedTheme = localStorage.getItem('inf_selected_theme') || 'beige-gold';
    const savedBlur = localStorage.getItem('inf_blur_level') || 'default';
    const savedAccent = localStorage.getItem('inf_accent_color') || '#D4AF37';

    document.body.setAttribute('data-current-theme', savedTheme);
    document.body.setAttribute('data-theme', savedTheme);
    themeButtons.forEach(btn => {
        if (btn.getAttribute('data-theme') === savedTheme) {
            themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
    });

    document.body.setAttribute('data-blur-level', savedBlur);
    blurButtons.forEach(btn => {
        if (btn.getAttribute('data-blur') === savedBlur) {
            blurButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
    });

    function applyAccentColor(color) {
        const hex = color.replace('#', '');
        const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ');
        document.documentElement.style.setProperty('--accent', color);
        document.documentElement.style.setProperty('--accent-rgb', rgb);
        document.documentElement.style.setProperty('--accent-gold', color);
        document.documentElement.style.setProperty('--border-gold', color);
    }
    applyAccentColor(savedAccent);
    accentColorButtons.forEach(btn => {
        if (btn.getAttribute('data-accent') === savedAccent) {
            accentColorButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
    });

    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const themeName = btn.getAttribute('data-theme');
            document.body.setAttribute('data-current-theme', themeName);
            document.body.setAttribute('data-theme', themeName);
            localStorage.setItem('inf_selected_theme', themeName);
        });
    });

    blurButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            blurButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const blurLevel = btn.getAttribute('data-blur');
            document.body.setAttribute('data-blur-level', blurLevel);
            localStorage.setItem('inf_blur_level', blurLevel);
        });
    });

    accentColorButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            accentColorButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const colorHex = btn.getAttribute('data-accent');
            applyAccentColor(colorHex);
            localStorage.setItem('inf_accent_color', colorHex);
        });
    });


    // --- 12. Advanced Utilities & Diagnostics Logic ---
    const runDiagBtn = document.getElementById('run-diag-btn');
    const cpuLoadVal = document.getElementById('cpu-load-val');
    const memLoadVal = document.getElementById('mem-load-val');
    const resetStorageBtn = document.getElementById('reset-storage-btn');

    if (runDiagBtn && cpuLoadVal && memLoadVal) {
        runDiagBtn.addEventListener('click', () => {
            runDiagBtn.textContent = 'Scanning Nodes...';
            runDiagBtn.style.opacity = '0.7';

            setTimeout(() => {
                const randomCpu = (10 + Math.random() * 15).toFixed(1) + '%';
                const randomMem = (2.2 + Math.random() * 0.5).toFixed(1) + ' GB / 8 GB';
                cpuLoadVal.textContent = randomCpu;
                memLoadVal.textContent = randomMem;
                runDiagBtn.textContent = 'Diagnostics OK';
                runDiagBtn.style.opacity = '1';
                setTimeout(() => {
                    runDiagBtn.textContent = 'Run Diagnostics';
                }, 2500);
            }, 1200);
        });
    }

    if (resetStorageBtn) {
        resetStorageBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to reset all local settings and customized device names?')) {
                localStorage.clear();
                location.reload();
            }
        });
    }
});
