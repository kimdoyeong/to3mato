import { mount } from 'svelte';
import '@fontsource/gamja-flower';
import '@fontsource/poor-story';
import './styles/tokens.css';
import './styles/components.css';
import './styles/app.css';
import App from './App.svelte';
mount(App, { target: document.getElementById('app')! });
