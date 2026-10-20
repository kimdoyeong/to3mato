import { mount } from 'svelte';
import '@fontsource/gamja-flower';
import '@fontsource/poor-story';
import './styles/base.css';
import './styles/theme.css';
import TrayApp from './TrayApp.svelte';
mount(TrayApp, { target: document.getElementById('app')! });
