'use strict';

/**
 * Closed value sets of a basket item (`basketItems[]`).
 *
 * The gateway validates these with a fixed list and answers an unknown value
 * with 400 (`basketItems.<i>.<field>` in `details.errors`).
 */

/**
 * Item kind for insurance (`insuranceCategory`). Lunixi resolves the insurance
 * types offered for the item from this value; `insuranceTypes` narrows the list.
 * Accepted on `POST /api/v1/payments/intents` only (Checkout Form).
 */
const InsuranceItemCategory = Object.freeze({
  /** Bus, flight or train ticket. */
  TICKET: 'TICKET',
  /** Accommodation booking. */
  HOTEL: 'HOTEL',
  /** Event ticket. */
  EVENT: 'EVENT',
  /** Mobile phone. */
  DEVICE: 'DEVICE',
  /** Electronics and home appliances. */
  ELECTRONICS: 'ELECTRONICS',
  /** Vehicle. */
  VEHICLE: 'VEHICLE',
  /** Travel or tour package. */
  TRAVEL: 'TRAVEL',
  /** Home. */
  HOME: 'HOME',
  /** Health service. */
  HEALTH: 'HEALTH',
  /** Pet. */
  PET: 'PET',
  /** Rented scooter and other micromobility. */
  MICROMOBILITY: 'MICROMOBILITY',
  /** Musical instrument. */
  MUSICAL_INSTRUMENT: 'MUSICAL_INSTRUMENT',
  /** Shipment, cargo. */
  SHIPMENT: 'SHIPMENT',
  /** Education, studying abroad. */
  EDUCATION: 'EDUCATION',
});

module.exports = { InsuranceItemCategory };
