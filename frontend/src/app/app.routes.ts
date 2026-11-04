import { Routes } from '@angular/router';
import { ChatViewComponent } from './chat/chat-view.component';

export const routes: Routes = [
  { path: '', component: ChatViewComponent },
  { path: 'c/:id', component: ChatViewComponent },
  { path: '**', redirectTo: '' },
];
