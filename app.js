document.addEventListener('DOMContentLoaded', () => {
    const faceOrder = ['U', 'R', 'F', 'D', 'L', 'B'];
    const hm10ServiceUuid = 0xFFE0;
    const hm10CharacteristicUuid = 0xFFE1;
    const colorNames = {
        U: 'White',
        R: 'Red',
        F: 'Green',
        D: 'Yellow',
        L: 'Orange',
        B: 'Blue'
    };
    const colorValues = {
        U: '#f5f5f5',
        R: '#e53935',
        F: '#43a047',
        D: '#fdd835',
        L: '#fb8c00',
        B: '#1e88e5'
    };
    const videoElement = document.getElementById('camera-feed');
    const scanGrid = document.querySelector('.scan-grid');
    const startButton = document.getElementById('start-camera');
    const captureButton = document.getElementById('capture-face');
    const faceSelect = document.getElementById('face-select');
    const statusDisplay = document.getElementById('scan-status');
    const reviewDisplay = document.getElementById('face-review');
    const faceProgress = document.getElementById('face-progress');
    const progressHeading = document.getElementById('progress-heading');
    const cameraPlaceholder = document.getElementById('camera-placeholder');
    const solveButton = document.getElementById('solve-cube');
    const resultDisplay = document.getElementById('result-display');
    const connectBluetoothButton = document.getElementById('connect-bluetooth');
    const sendSolutionButton = document.getElementById('send-solution');
    const bluetoothStatus = document.getElementById('bluetooth-status');
    const rawFaces = Object.fromEntries(faceOrder.map(face => [face, null]));
    const corrections = new Map();
    let cameraStream = null;
    let solverReady = false;
    let hm10Device = null;
    let hm10Characteristic = null;
    let lastSolution = null;
    let isConnecting = false;
    let isSending = false;
    let isSolving = false;
    let isCapturing = false;
    const bluetoothSupported = Boolean(navigator.bluetooth);

    function setStatus(message, isError) {
        statusDisplay.textContent = message;
        statusDisplay.classList.toggle('error', Boolean(isError));
    }

    function setBluetoothStatus(message, isError) {
        bluetoothStatus.textContent = message;
        bluetoothStatus.classList.toggle('error', Boolean(isError));
    }

    function updateBluetoothControls() {
        const connected = Boolean(hm10Device && hm10Device.gatt && hm10Device.gatt.connected);
        connectBluetoothButton.textContent = connected ? 'Disconnect HM-10' : 'Connect HM-10';
        connectBluetoothButton.disabled = !bluetoothSupported || isConnecting || isSending;
        sendSolutionButton.disabled = !connected || !lastSolution || isConnecting || isSending;
    }

    function updateCaptureControls() {
        const canCapture = Boolean(cameraStream) && !isCapturing && !isSolving && !isSending;
        captureButton.disabled = !canCapture;
    }

    function renderFaceProgress() {
        const capturedCount = faceOrder.filter(face => rawFaces[face]).length;
        progressHeading.textContent = `${capturedCount} of 6 captured`;
        faceProgress.replaceChildren();

        faceOrder.forEach(face => {
            const step = document.createElement('div');
            step.className = `face-step${rawFaces[face] ? ' complete' : ''}`;
            if (!rawFaces[face] && face === faceSelect.value) {
                step.classList.add('current');
            }
            step.textContent = face;
            step.setAttribute(
                'aria-label',
                `${face} face ${rawFaces[face] ? 'captured' : 'not captured'}`
            );
            faceProgress.appendChild(step);
        });
    }

    function clearSolution() {
        lastSolution = null;
        updateBluetoothControls();
    }

    function handleBluetoothDisconnect() {
        hm10Characteristic = null;
        hm10Device = null;
        updateBluetoothControls();
        setBluetoothStatus('HM-10 disconnected.', false);
    }

    async function connectToHm10() {
        if (!bluetoothSupported) {
            throw new Error('Web Bluetooth is unavailable. Try a supported browser over HTTPS.');
        }

        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [hm10ServiceUuid] }]
        });
        device.addEventListener('gattserverdisconnected', handleBluetoothDisconnect);
        try {
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(hm10ServiceUuid);
            const characteristic = await service.getCharacteristic(hm10CharacteristicUuid);
            const properties = characteristic.properties;
            if (!properties.write && !properties.writeWithoutResponse) {
                throw new Error('The HM-10 characteristic does not support writing.');
            }

            hm10Device = device;
            hm10Characteristic = characteristic;
            updateBluetoothControls();
            setBluetoothStatus(`Connected to ${device.name || 'HM-10'}.`, false);
        } catch (error) {
            if (device.gatt && device.gatt.connected) {
                device.gatt.disconnect();
            }
            throw error;
        }
    }

    async function writeHm10Chunk(chunk) {
        if (!hm10Characteristic || !hm10Device || !hm10Device.gatt.connected) {
            throw new Error('The HM-10 is not connected.');
        }

        if (hm10Characteristic.properties.writeWithoutResponse &&
            typeof hm10Characteristic.writeValueWithoutResponse === 'function') {
            await hm10Characteristic.writeValueWithoutResponse(chunk);
        } else if (hm10Characteristic.properties.write &&
            typeof hm10Characteristic.writeValueWithResponse === 'function') {
            await hm10Characteristic.writeValueWithResponse(chunk);
        } else if (typeof hm10Characteristic.writeValue === 'function') {
            await hm10Characteristic.writeValue(chunk);
        } else {
            throw new Error('This browser cannot write to the HM-10 characteristic.');
        }
    }

    async function sendSolutionToHm10(solution) {
        if (!solution) {
            throw new Error('There is no solution to send.');
        }

        const bytes = new TextEncoder().encode(`${solution}\n`);
        const chunkSize = 20;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            await writeHm10Chunk(bytes.slice(offset, offset + chunkSize));
            if (offset + chunkSize < bytes.length) {
                await new Promise(resolve => setTimeout(resolve, 30));
            }
        }
        return bytes.length;
    }

    function updateCaptureLabel() {
        captureButton.textContent = `Capture ${faceSelect.value} face`;
    }

    function updateGridSize() {
        const videoRect = videoElement.getBoundingClientRect();
        if (videoRect.width && videoRect.height) {
            scanGrid.style.width = `${Math.min(videoRect.width * 0.72, videoRect.height * 0.92)}px`;
        }
    }

    function rgbToLab(rgb) {
        const linear = rgb.map(value => {
            const channel = value / 255;
            return channel <= 0.04045
                ? channel / 12.92
                : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
        const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
        const pivot = value => value > 0.008856
            ? Math.cbrt(value)
            : (7.787 * value) + (16 / 116);
        const fx = pivot(x);
        const fy = pivot(y);
        const fz = pivot(z);
        return [
            (116 * fy) - 16,
            500 * (fx - fy),
            200 * (fy - fz)
        ];
    }

    function distance(left, right) {
        return Math.sqrt(
            Math.pow(left[0] - right[0], 2) +
            Math.pow(left[1] - right[1], 2) +
            Math.pow(left[2] - right[2], 2)
        );
    }

    function median(values) {
        const sorted = values.slice().sort((left, right) => left - right);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function getCenters() {
        const centers = {};
        faceOrder.forEach(face => {
            if (rawFaces[face]) {
                centers[face] = rgbToLab(rawFaces[face][4]);
            }
        });
        return centers;
    }

    function classify(rgb, centers) {
        const sample = rgbToLab(rgb);
        let closestFace = null;
        let closestDistance = Infinity;
        Object.keys(centers).forEach(face => {
            const candidateDistance = distance(sample, centers[face]);
            if (candidateDistance < closestDistance) {
                closestFace = face;
                closestDistance = candidateDistance;
            }
        });
        return closestFace;
    }

    function getFacelets() {
        const centers = getCenters();
        return faceOrder.flatMap(face => {
            if (!rawFaces[face]) {
                return Array(9).fill(null);
            }
            return rawFaces[face].map((sample, index) => {
                const key = `${face}-${index}`;
                return corrections.has(key) ? corrections.get(key) : classify(sample, centers);
            });
        });
    }

    function renderReview(preserveStatus) {
        const centers = getCenters();
        const facelets = getFacelets();
        reviewDisplay.replaceChildren();
        renderFaceProgress();

        faceOrder.forEach((face, faceIndex) => {
            const card = document.createElement('section');
            card.className = 'face-card';
            const heading = document.createElement('h3');
            heading.textContent = `${face} — ${colorNames[face]}`;
            card.appendChild(heading);

            const grid = document.createElement('div');
            grid.className = 'sticker-grid';
            for (let stickerIndex = 0; stickerIndex < 9; stickerIndex += 1) {
                const facelet = facelets[(faceIndex * 9) + stickerIndex];
                const sticker = document.createElement('button');
                sticker.type = 'button';
                sticker.className = `sticker${facelet ? '' : ' unknown'}`;
                sticker.style.backgroundColor = facelet ? colorValues[facelet] : '#333';
                sticker.setAttribute(
                    'aria-label',
                    `${face} sticker ${stickerIndex + 1}: ${facelet ? colorNames[facelet] : 'not detected'}`
                );
                sticker.title = facelet
                    ? `${colorNames[facelet]} — click to correct`
                    : 'Not detected';
                sticker.disabled = isSolving || isSending || !rawFaces[face] || stickerIndex === 4;
                sticker.addEventListener('click', () => {
                    const current = facelets[(faceIndex * 9) + stickerIndex];
                    const nextIndex = (faceOrder.indexOf(current) + 1) % faceOrder.length;
                    corrections.set(`${face}-${stickerIndex}`, faceOrder[nextIndex]);
                    clearSolution();
                    resultDisplay.textContent = '';
                    renderReview();
                });
                grid.appendChild(sticker);
            }
            card.appendChild(grid);
            reviewDisplay.appendChild(card);
        });

        const counts = Object.fromEntries(faceOrder.map(face => [face, 0]));
        facelets.forEach(face => {
            if (face) {
                counts[face] += 1;
            }
        });
        const allFacesCaptured = faceOrder.every(face => rawFaces[face]);
        const centersDistinct = allFacesCaptured && faceOrder.every((face, index) =>
            faceOrder.slice(index + 1).every(otherFace =>
                distance(centers[face], centers[otherFace]) >= 15
            )
        );
        const balancedCounts = faceOrder.every(face => counts[face] === 9);
        solveButton.disabled = isSolving || isSending || !solverReady || !allFacesCaptured || !centersDistinct || !balancedCounts;

        if (preserveStatus) {
            return;
        }
        if (allFacesCaptured && !centersDistinct) {
            setStatus('The six center colors are too similar. Check the lighting and recapture the affected faces.', true);
        } else if (allFacesCaptured && !balancedCounts) {
            setStatus('The scan needs exactly nine stickers of each color. Click incorrect stickers to fix them.', true);
        } else if (allFacesCaptured && balancedCounts) {
            setStatus('All faces scanned. Review the sticker colors, then solve the cube.', false);
        }
    }

    async function sampleFrame() {
        if (!videoElement.videoWidth || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            throw new Error('Wait for the camera image to appear before capturing a face.');
        }

        const videoRect = videoElement.getBoundingClientRect();
        const gridRect = scanGrid.getBoundingClientRect();
        const cellWidth = gridRect.width / 3;
        const cellHeight = gridRect.height / 3;
        const samples = Array.from({ length: 9 }, () => [[], [], []]);
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
            throw new Error('Could not read pixels from the camera.');
        }

        for (let frame = 0; frame < 5; frame += 1) {
            if (frame > 0) {
                await new Promise(resolve => setTimeout(resolve, 70));
            }
            context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

            for (let index = 0; index < 9; index += 1) {
                const row = Math.floor(index / 3);
                const column = index % 3;
                const displayX = gridRect.left + ((column + 0.5) * cellWidth);
                const displayY = gridRect.top + ((row + 0.5) * cellHeight);
                const centerX = Math.round(((displayX - videoRect.left) / videoRect.width) * canvas.width);
                const centerY = Math.round(((displayY - videoRect.top) / videoRect.height) * canvas.height);
                const sampleWidth = Math.max(3, Math.round((cellWidth * 0.4 / videoRect.width) * canvas.width));
                const sampleHeight = Math.max(3, Math.round((cellHeight * 0.4 / videoRect.height) * canvas.height));
                const left = Math.max(0, Math.min(canvas.width - sampleWidth, centerX - Math.floor(sampleWidth / 2)));
                const top = Math.max(0, Math.min(canvas.height - sampleHeight, centerY - Math.floor(sampleHeight / 2)));
                const pixels = context.getImageData(left, top, sampleWidth, sampleHeight).data;
                const channels = [[], [], []];
                for (let pixel = 0; pixel < pixels.length; pixel += 4) {
                    channels[0].push(pixels[pixel]);
                    channels[1].push(pixels[pixel + 1]);
                    channels[2].push(pixels[pixel + 2]);
                }
                for (let channel = 0; channel < 3; channel += 1) {
                    samples[index][channel].push(median(channels[channel]));
                }
            }
        }

        return samples.map(sample => sample.map(median));
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        videoElement.srcObject = null;
        cameraPlaceholder.classList.remove('hidden');
        startButton.textContent = 'Turn On Camera';
        updateCaptureControls();
    }

    if (typeof Cube !== 'undefined') {
        try {
            Cube.initSolver();
            solverReady = true;
        } catch (error) {
            console.error('Could not initialize the cube solver:', error);
            setStatus(`Solver initialization failed: ${error.message}`, true);
        }
    } else {
        setStatus('Cube solver library did not load. Check your internet connection and reload.', true);
    }

    startButton.addEventListener('click', async () => {
        if (cameraStream) {
            stopCamera();
            setStatus('Camera turned off.', false);
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus('Camera access is not available in this browser. Use HTTPS and allow camera access.', true);
            return;
        }
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            videoElement.srcObject = cameraStream;
            await videoElement.play();
            cameraPlaceholder.classList.add('hidden');
            updateGridSize();
            updateCaptureControls();
            startButton.textContent = 'Turn Off Camera';
            setStatus('Center one face in the grid, choose its face label, and capture it.', false);
        } catch (error) {
            if (cameraStream) {
                cameraStream.getTracks().forEach(track => track.stop());
            }
            cameraStream = null;
            videoElement.srcObject = null;
            console.error('Error accessing the camera:', error);
            setStatus(`Could not access the camera: ${error.message}`, true);
        }
    });

    connectBluetoothButton.addEventListener('click', async () => {
        if (isConnecting || isSending) {
            return;
        }

        if (hm10Device && hm10Device.gatt && hm10Device.gatt.connected) {
            hm10Device.gatt.disconnect();
            return;
        }

        isConnecting = true;
        updateBluetoothControls();
        setBluetoothStatus('Select the HM-10 in the browser Bluetooth prompt...', false);
        try {
            await connectToHm10();
        } catch (error) {
            console.error('Could not connect to the HM-10:', error);
            hm10Characteristic = null;
            hm10Device = null;
            setBluetoothStatus(`Could not connect: ${error.message}`, true);
        } finally {
            isConnecting = false;
            updateBluetoothControls();
        }
    });

    sendSolutionButton.addEventListener('click', async () => {
        if (!lastSolution || isSending || isSolving) {
            return;
        }

        isSending = true;
        updateBluetoothControls();
        updateCaptureControls();
        renderReview(true);
        setBluetoothStatus('Sending solution to the HM-10...', false);
        try {
            const byteCount = await sendSolutionToHm10(lastSolution);
            setBluetoothStatus(`Sent ${byteCount} bytes to the HM-10.`, false);
        } catch (error) {
            console.error('Could not send the solution to the HM-10:', error);
            setBluetoothStatus(`Send failed: ${error.message}`, true);
        } finally {
            isSending = false;
            updateBluetoothControls();
            updateCaptureControls();
            renderReview(true);
        }
    });

    faceSelect.addEventListener('change', () => {
        updateCaptureLabel();
        renderFaceProgress();
    });

    async function captureFace() {
        if (!cameraStream || isCapturing || isSolving || isSending) {
            return;
        }

        const face = faceSelect.value;
        isCapturing = true;
        updateCaptureControls();
        clearSolution();
        resultDisplay.textContent = '';
        setStatus('Hold the cube steady while the camera samples each sticker...', false);
        try {
            rawFaces[face] = await sampleFrame();
            for (let index = 0; index < 9; index += 1) {
                corrections.delete(`${face}-${index}`);
            }
            const nextFace = faceOrder.find(candidate => !rawFaces[candidate]);
            if (nextFace) {
                faceSelect.value = nextFace;
            }
            updateCaptureLabel();
            renderReview();
            setStatus(`Captured ${face} face. Review it or continue with the next face.`, false);
        } catch (error) {
            console.error('Error capturing cube face:', error);
            setStatus(error.message, true);
        } finally {
            isCapturing = false;
            updateCaptureControls();
        }
    }

    captureButton.addEventListener('click', () => {
        void captureFace();
    });

    solveButton.addEventListener('click', async () => {
        if (isSolving || isSending) {
            return;
        }

        isSolving = true;
        updateCaptureControls();
        solveButton.disabled = true;
        clearSolution();
        try {
            const facelets = getFacelets();
            if (facelets.length !== 54 || facelets.some(face => !face)) {
                throw new Error('Scan all six faces and correct any undetected stickers first.');
            }
            const cube = Cube.fromString(facelets.join(''));
            const solution = cube.solve().trim();
            lastSolution = solution || null;
            resultDisplay.textContent = solution
                ? `Solution (${solution.trim().split(/\s+/).length} moves): ${solution}`
                : 'The cube is already solved.';
            updateBluetoothControls();
            if (lastSolution && hm10Device && hm10Device.gatt && hm10Device.gatt.connected) {
                isSending = true;
                updateBluetoothControls();
                updateCaptureControls();
                renderReview(true);
                setBluetoothStatus('Solution generated. Sending it to the HM-10...', false);
                try {
                    const byteCount = await sendSolutionToHm10(lastSolution);
                    setBluetoothStatus(`Sent ${byteCount} bytes to the HM-10.`, false);
                } catch (error) {
                    console.error('Could not send the solved moves to the HM-10:', error);
                    setBluetoothStatus(`Solution generated, but send failed: ${error.message}`, true);
                } finally {
                    isSending = false;
                }
            } else if (lastSolution) {
                setBluetoothStatus('Solution ready. Connect the HM-10 to enable sending.', false);
            } else {
                setBluetoothStatus('The cube is already solved; there are no moves to send.', false);
            }
            setStatus('Solution generated from the scanned cube.', false);
        } catch (error) {
            console.error('Error solving scanned cube:', error);
            resultDisplay.textContent = `Could not solve this scan: ${error.message}`;
            setStatus('The scanned colors may not describe a valid cube. Review the face order and stickers.', true);
        } finally {
            isSolving = false;
            isSending = false;
            updateCaptureControls();
            updateBluetoothControls();
            renderReview(true);
        }
    });

    window.addEventListener('beforeunload', stopCamera);
    window.addEventListener('resize', updateGridSize);
    videoElement.addEventListener('loadedmetadata', updateGridSize);
    updateCaptureLabel();
    updateBluetoothControls();
    if (!bluetoothSupported) {
        setBluetoothStatus('Web Bluetooth is unavailable in this browser or page context. Use a supported browser over HTTPS.', true);
    }
    renderReview();
});
