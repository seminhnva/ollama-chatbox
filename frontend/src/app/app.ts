import { Component, HostListener, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatStore } from './core/chat.store';
import { ThemeService } from './core/theme.service';
import { SidebarComponent } from './sidebar/sidebar.component';

@Component({
  imports: [RouterOutlet, SidebarComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected readonly theme = inject(ThemeService);
  protected readonly store = inject(ChatStore);
  protected readonly sidebarOpen = signal(false);

  @HostListener('document:keydown.escape')
  protected closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
