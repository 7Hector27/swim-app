import { describe, expect, it } from "vitest";
import { mapBookingApiResponse } from "../content/BookLessonContent/helpers";

describe("mapBookingApiResponse", () => {
  it("maps 422 not_a_lesson_day to friendly message", () => {
    const result = mapBookingApiResponse(422, { error: "not_a_lesson_day" });
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("isn't available for lessons");
  });

  it("maps 422 too_soon to the text Jason message", () => {
    const result = mapBookingApiResponse(422, { error: "too_soon" });
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("text Jason");
  });

  it("maps 422 too_far to advance limit message", () => {
    const result = mapBookingApiResponse(422, { error: "too_far" });
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("10 weeks");
  });

  it("maps 422 slot_unavailable to taken message", () => {
    const result = mapBookingApiResponse(422, { error: "slot_unavailable" });
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("just taken");
  });

  it("maps 403 to permission denied message", () => {
    const result = mapBookingApiResponse(403, { error: "forbidden" });
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("permission");
  });

  it("maps 500 to generic error", () => {
    const result = mapBookingApiResponse(500, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("Something went wrong");
  });

  it("maps 422 with unknown error code to generic message", () => {
    const result = mapBookingApiResponse(422, { error: "unknown_code" });
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("Something went wrong");
  });

  it("maps 422 with non-string error to generic message", () => {
    const result = mapBookingApiResponse(422, { error: 42 });
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("Something went wrong");
  });
});
