# Rubik-s-Cube-Solver-Web-App
This is a project created as part of an Engineering Disertation.

The purpose of this web-app is to scan a scrambled 3x3 Rubik's Cube using the devices onboard camera, and generate a solve string using cubejs 1.3.0 which is optionally sent over Bluetooth.

## Scanning and Solving
Open the app from `localhost` or an HTTPS site so the browser can access the camera. Hold the cube with U on top and F toward you, then capture faces in `U, R, F, D, L, B` order, selecting the label for the face pointed at the camera. For R/F/L/B, keep the U edge at the top of the camera grid; for U, put the F edge at the bottom; for D, put the F edge at the top. Center all nine stickers in the on-screen grid.

The scanner samples the center of each grid cell, calibrates the six colors from the face centers, and maps the results into the face order expected by cubejs. Ensure good lighting, a steady camera, and correct face orientation for best reading results. Manual review is avalible for the six detected grids before solving. Click a non-center sticker to cycle its color if needed. The solver is enabled when all six faces are scanned and there are nine stickers of each color.

## Bluetooth Communication
This project could just be used as a web-app solver, as it will output the final solve string. But it's intended use is for the solve string string to be sent over Bluetooth to a HM-10 