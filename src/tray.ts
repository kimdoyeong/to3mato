import { mount } from 'svelte';
import '@fontsource/gamja-flower';
import '@fontsource/poor-story';
import './styles/tokens.css';
import './styles/components.css';
import TrayApp from './TrayApp.svelte';
mount(TrayApp, { target: document.getElementById('app')! });
