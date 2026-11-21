/**
 * JSON value type - any valid JSON value.
 *
 * JsonObject is an interface: as a recursive type alias it hit TS2589
 * "excessively deep" errors in immer's type inference.
 */
export type JsonValue =
  null | boolean | number | string | JsonArray | JsonObject;

export type JsonArray = JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
