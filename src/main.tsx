import 'prosemirror-view/style/prosemirror.css';
import './ui/app.css';
import { render } from 'preact';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
