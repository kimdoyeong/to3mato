import { mount } from 'svelte';
import '@fontsource/gamja-flower';
import '@fontsource/poor-story';
import './styles/base.css';
import './styles/theme.css';
import './styles/app.css';
import App from './App.svelte';
mount(App, { target: document.getElementById('app')! });
