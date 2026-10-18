import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PasswordInput from "../components/PasswordInput/PasswordInput";

describe("PasswordInput", () => {
  it("starts as a password field", () => {
    render(
      <>
        <label htmlFor="pwd">Password</label>
        <PasswordInput id="pwd" name="pwd" />
      </>,
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("shows the password after clicking the toggle", () => {
    render(
      <>
        <label htmlFor="pwd">Password</label>
        <PasswordInput id="pwd" name="pwd" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  });

  it("hides the password again on a second click", () => {
    render(
      <>
        <label htmlFor="pwd">Password</label>
        <PasswordInput id="pwd" name="pwd" />
      </>,
    );
    const toggle = screen.getByRole("button", { name: "Show password" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("shows 'Show password' label when hidden", () => {
    render(
      <>
        <label htmlFor="pwd">Password</label>
        <PasswordInput id="pwd" name="pwd" />
      </>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Show password");
  });

  it("switches to 'Hide password' label after toggle", () => {
    render(
      <>
        <label htmlFor="pwd">Password</label>
        <PasswordInput id="pwd" name="pwd" />
      </>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Hide password");
  });

  it("does not submit the form when the toggle is clicked", () => {
    const handleSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={handleSubmit}>
        <label htmlFor="pwd">Password</label>
        <PasswordInput id="pwd" name="pwd" />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
