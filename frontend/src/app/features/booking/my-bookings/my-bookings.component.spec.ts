import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MyBookingsComponent } from './my-bookings.component';
import { BookingService } from '../services/booking.service';
import { Booking, BookingListResponse } from '../../../core/models/booking.models';

function mockBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    clientId: 'c1',
    artist: {
      artistProfileId: 'a1',
      artistName: 'Alice Black',
      slug: 'alice-black',
      profilePhotoUrl: null
    },
    status: 'confirmed',
    bookingDate: '2026-08-03',
    startTime: '10:00',
    endTime: '12:00',
    estimatedPriceMin: 40000,
    estimatedPriceMax: 60000,
    depositAmount: 12000,
    hasReview: false,
    notes: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides
  };
}

function listResponse(data: Booking[], total = data.length): BookingListResponse {
  return { data, total, page: 1, pageSize: 10 };
}

describe('MyBookingsComponent', () => {
  let fixture: ComponentFixture<MyBookingsComponent>;
  let component: MyBookingsComponent;
  let bookingService: BookingService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MyBookingsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    bookingService = TestBed.inject(BookingService);
  });

  function createComponent(): void {
    fixture = TestBed.createComponent(MyBookingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('renderiza las reservas con nombre de artista, fecha y estado', () => {
    spyOn(bookingService, 'getMyBookings').and.returnValue(
      of(listResponse([mockBooking(), mockBooking({ id: 'b2', status: 'cancelled' })]))
    );
    createComponent();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('app-booking-card');
    expect(cards.length).toBe(2);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Alice Black');
    expect(text).toContain('Confirmada');
    expect(text).toContain('Cancelada');
  });

  it('muestra el estado vacío con CTA a la vitrina (CA7)', () => {
    spyOn(bookingService, 'getMyBookings').and.returnValue(of(listResponse([])));
    createComponent();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No tienes reservas aún');
    expect(fixture.nativeElement.querySelector('a[href="/"]')).toBeTruthy();
  });

  it('muestra error con reintento cuando la carga falla', () => {
    spyOn(bookingService, 'getMyBookings').and.returnValue(throwError(() => new Error('fail')));
    createComponent();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No pudimos cargar tus reservas');
  });

  it('confirmar asistencia actualiza la card a completada (CA9)', fakeAsync(() => {
    const booking = mockBooking({ bookingDate: '2026-01-05' }); // pasada
    spyOn(bookingService, 'getMyBookings').and.returnValue(of(listResponse([booking])));
    spyOn(bookingService, 'completeBooking').and.returnValue(
      of(mockBooking({ bookingDate: '2026-01-05', status: 'completed' }))
    );
    createComponent();
    fixture.detectChanges();

    component.onComplete(booking);
    tick();
    fixture.detectChanges();

    expect(bookingService.completeBooking).toHaveBeenCalledWith('b1');
    expect(component.bookings()[0].status).toBe('completed');
    expect(fixture.nativeElement.textContent).toContain('Asistencia confirmada');
    discardPeriodicTasks();
  }));

  it('cancelar reserva actualiza la card a cancelada (CA11)', fakeAsync(() => {
    const booking = mockBooking();
    spyOn(bookingService, 'getMyBookings').and.returnValue(of(listResponse([booking])));
    spyOn(bookingService, 'cancelBooking').and.returnValue(
      of(mockBooking({ status: 'cancelled' }))
    );
    createComponent();
    fixture.detectChanges();

    component.onCancel(booking);
    tick();
    fixture.detectChanges();

    expect(bookingService.cancelBooking).toHaveBeenCalledWith('b1');
    expect(component.bookings()[0].status).toBe('cancelled');
    discardPeriodicTasks();
  }));

  it('pagina con "Ver más" cuando hay más reservas', () => {
    const first = listResponse([mockBooking()], 2);
    const second = listResponse([mockBooking({ id: 'b2' })], 2);
    const spy = spyOn(bookingService, 'getMyBookings').and.returnValues(of(first), of(second));
    createComponent();
    fixture.detectChanges();

    expect(component.hasMore()).toBeTrue();
    component.loadMore();
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith(2, 10);
    expect(component.bookings().length).toBe(2);
    expect(component.hasMore()).toBeFalse();
  });
});
