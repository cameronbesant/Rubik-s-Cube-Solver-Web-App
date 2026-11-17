document.addEventListener('DOMContentLoaded', () => {
    const faceOrder = ['U', 'R', 'F', 'D', 'L', 'B'];
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
    const solveButton = document.getElementById('solve-cube');
    const resultDisplay = document.getElementById('result-display');
    const rawFaces = Object.fromEntries(faceOrder.map(face => [face, null]));
    const corrections = new Map();
    let cameraStream = null;
    let solverReady = false;

    function setStatus(message, isError) {
        statusDisplay.textContent = message;
        statusDisplay.classList.toggle('error', Boolean(isError));
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

    function renderReview() {
        const centers = getCenters();
        const facelets = getFacelets();
        reviewDisplay.replaceChildren();

        faceOrder.forEach((face, faceIndex) => {
            const card = document.createElement('section');
            card.className = 'face-card';
            const heading = document.createElement('h3');
            heading.textContent = `${face} — ${colorNames[face]}${rawFaces[face] ? '' : ' (not scanned)'}`;
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
                sticker.disabled = !rawFaces[face] || stickerIndex === 4;
                sticker.addEventListener('click', () => {
                    const current = facelets[(faceIndex * 9) + stickerIndex];
                    const nextIndex = (faceOrder.indexOf(current) + 1) % faceOrder.length;
                    corrections.set(`${face}-${stickerIndex}`, faceOrder[nextIndex]);
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
        solveButton.disabled = !solverReady || !allFacesCaptured || !centersDistinct || !balancedCounts;

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
        captureButton.disabled = true;
        startButton.textContent = 'Turn On Camera';
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
            updateGridSize();
            captureButton.disabled = false;
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

    faceSelect.addEventListener('change', updateCaptureLabel);
    captureButton.addEventListener('click', async () => {
        const face = faceSelect.value;
        captureButton.disabled = true;
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
            resultDisplay.textContent = '';
            renderReview();
        } catch (error) {
            console.error('Error capturing cube face:', error);
            setStatus(error.message, true);
        } finally {
            captureButton.disabled = !cameraStream;
        }
    });

    solveButton.addEventListener('click', () => {
        try {
            const facelets = getFacelets();
            if (facelets.length !== 54 || facelets.some(face => !face)) {
                throw new Error('Scan all six faces and correct any undetected stickers first.');
            }
            const cube = Cube.fromString(facelets.join(''));
            const solution = cube.solve();
            resultDisplay.textContent = solution
                ? `Solution (${solution.trim().split(/\s+/).length} moves): ${solution}`
                : 'The cube is already solved.';
            setStatus('Solution generated from the scanned cube.', false);
        } catch (error) {
            console.error('Error solving scanned cube:', error);
            resultDisplay.textContent = `Could not solve this scan: ${error.message}`;
            setStatus('The scanned colors may not describe a valid cube. Review the face order and stickers.', true);
        }
    });

    const testButton = document.getElementById('test-solver');
    testButton.addEventListener('click', () => {
        try {
            const cube = Cube.fromString('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
            cube.move("R U R' U'");
            const solution = cube.solve();
            resultDisplay.textContent = `Sample solution: ${solution}`;
        } catch (error) {
            console.error('Error running solver test:', error);
            resultDisplay.textContent = `Solver test failed: ${error.message}`;
        }
    });

    window.addEventListener('beforeunload', stopCamera);
    window.addEventListener('resize', updateGridSize);
    videoElement.addEventListener('loadedmetadata', updateGridSize);
    updateCaptureLabel();
    renderReview();
});
