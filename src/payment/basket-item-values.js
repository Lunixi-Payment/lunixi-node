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

/**
 * Lunixi product category (`productCategory`). Used by payment methods with
 * legal installment limits (e.g. shopping loan) and other platform features.
 * Optional on every endpoint that takes basket items and on payment link
 * items; an unknown value is answered with 400. The list only grows by
 * appending.
 */
const ProductCategory = Object.freeze({
  MOBILE_PHONE: 'MOBILE_PHONE',
  TABLET: 'TABLET',
  COMPUTER: 'COMPUTER',
  TV_AUDIO: 'TV_AUDIO',
  WHITE_GOODS: 'WHITE_GOODS',
  SMALL_APPLIANCE: 'SMALL_APPLIANCE',
  CAMERA: 'CAMERA',
  GAME_CONSOLE: 'GAME_CONSOLE',
  WEARABLE: 'WEARABLE',
  ELECTRONICS_ACCESSORY: 'ELECTRONICS_ACCESSORY',
  ELECTRONICS_OTHER: 'ELECTRONICS_OTHER',
  GOLD: 'GOLD',
  JEWELRY: 'JEWELRY',
  WATCH: 'WATCH',
  APPAREL: 'APPAREL',
  SHOES_BAGS: 'SHOES_BAGS',
  COSMETICS: 'COSMETICS',
  FURNITURE: 'FURNITURE',
  HOME_LIVING: 'HOME_LIVING',
  GROCERY: 'GROCERY',
  BOOKS_MEDIA: 'BOOKS_MEDIA',
  TOYS: 'TOYS',
  SPORTS_OUTDOOR: 'SPORTS_OUTDOOR',
  PET_SUPPLIES: 'PET_SUPPLIES',
  AUTO_PARTS: 'AUTO_PARTS',
  MUSICAL_INSTRUMENT: 'MUSICAL_INSTRUMENT',
  MICROMOBILITY: 'MICROMOBILITY',
  VEHICLE: 'VEHICLE',
  TRANSPORT_TICKET: 'TRANSPORT_TICKET',
  EVENT_TICKET: 'EVENT_TICKET',
  ACCOMMODATION: 'ACCOMMODATION',
  TRAVEL_PACKAGE: 'TRAVEL_PACKAGE',
  HEALTH_SERVICE: 'HEALTH_SERVICE',
  EDUCATION: 'EDUCATION',
  SHIPPING_SERVICE: 'SHIPPING_SERVICE',
  DIGITAL_GOODS: 'DIGITAL_GOODS',
  GIFT_CARD: 'GIFT_CARD',
  SUBSCRIPTION: 'SUBSCRIPTION',
  SERVICE_OTHER: 'SERVICE_OTHER',
  OTHER: 'OTHER',
});

module.exports = { InsuranceItemCategory, ProductCategory };
