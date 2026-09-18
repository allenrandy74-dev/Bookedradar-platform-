export class BookingAdapter {
  async findAvailability(_request) {
    throw new Error("Booking adapter not implemented");
  }
  async createBooking(_request) {
    throw new Error("Booking adapter not implemented");
  }
}

export class ConfirmOnlyBookingAdapter extends BookingAdapter {
  async findAvailability({ preferredWindow = "" } = {}) {
    return {
      mode: "confirm_only",
      confirmed: false,
      preferredWindow,
      message: "A team member must confirm the appointment.",
    };
  }

  async createBooking() {
    return {
      mode: "confirm_only",
      confirmed: false,
      reason: "live_booking_not_enabled",
    };
  }
}
