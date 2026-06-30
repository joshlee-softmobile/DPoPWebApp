import '@shoelace-style/shoelace/dist/themes/light.css';
import '@shoelace-style/shoelace/dist/themes/dark.css';
import './index.css';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import '@shoelace-style/shoelace';

// Set base path for Shoelace icons/assets to CDN
setBasePath('https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.20.1/dist/');

import { manifesto } from './src/Manifest.js';
import { bootstrapper } from './src/Bootstrap.js';

manifesto();
bootstrapper();