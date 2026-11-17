# Rubik-s-Cube-Solver-Web-App
This is a project created as part of an Engineering Disertation.

The purpose of this web-app is to scan a scrambled 3x3 Rubik's Cube using the devices onboard camera, and generate a solve string using cubejs 1.3.0 which is optionally sent over Bluetooth.
The web-app can be accessed from https://cameronbesant.github.io/Rubik-s-Cube-Solver-Web-App/

## Scanning and Solving
Hold the cube with U on top and F toward you, then capture faces in `U, R, F, D, L, B` order, selecting the label for the face pointed at the camera. For R/F/L/B, keep the U edge at the top of the camera grid; for U, put the F edge at the bottom; for D, put the F edge at the top. Center all nine stickers in the on-screen grid.

The scanner samples the center of each grid cell, calibrates the six colors from the face centers, and maps the results into the face order expected by cubejs. Ensure good lighting, a steady camera, and correct face orientation for best reading results. Manual review is avalible for the six detected grids before solving. Click a non-center sticker to cycle its color if needed. The solver is enabled when all six faces are scanned and there are nine stickers of each color.

## Bluetooth Communication
This project is created to be used in conjunction with a Rubik's Cube Solving Machine which uses a HM-10 BLuetooth module. When connected, **Solve cube** automatically sends a generated solution; if you connect afterward, choose **Send solution**. Moves are transmitted as UTF-8/ASCII text, terminated by a newline. Writes are split into 20-byte chunks for compatibility with the HM-10's typical BLE packet size.

If on an IOS system, since web-Bluetooth is not supported on Safari, download the free Bluefy app off of the App Store which allows for web browsing with Bluetooth access (https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055). 

## Credits
* **cubejs** - Rubik's Cube solver library by Petri Lehtinen and Ludovic Fernandez, licensed under the MIT License.