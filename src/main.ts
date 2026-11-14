import { createApp } from 'vue';
import App from './App.vue';
import './app.css';
import { boot } from './store';

createApp(App).mount('#app');

void boot();
