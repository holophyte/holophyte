import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CLAUDE_MODELS, DEFAULT_MODEL, ModelPicker } from './ModelPicker';

describe('ModelPicker', () => {
  describe('constants', () => {
    it('has three models', () => {
      expect(CLAUDE_MODELS).toHaveLength(3);
    });

    it('DEFAULT_MODEL matches Haiku (fastest/cheapest for quick tasks)', () => {
      expect(DEFAULT_MODEL).toBe('claude-haiku-4-5-20251001');
    });

    it('DEFAULT_MODEL is one of the model IDs in CLAUDE_MODELS', () => {
      const ids = CLAUDE_MODELS.map((m) => m.id);
      expect(ids).toContain(DEFAULT_MODEL);
    });
  });

  describe('closed state (default)', () => {
    it('shows the label of the currently selected model', () => {
      render(<ModelPicker value="claude-opus-4-6" onChange={vi.fn()} />);
      expect(screen.getByText('Opus 4.6')).toBeInTheDocument();
    });

    it('shows DEFAULT_MODEL label when value is DEFAULT_MODEL', () => {
      render(<ModelPicker value={DEFAULT_MODEL} onChange={vi.fn()} />);
      expect(screen.getByText('Haiku 4.5')).toBeInTheDocument();
    });

    it('does not show other model options before opening', () => {
      render(<ModelPicker value={DEFAULT_MODEL} onChange={vi.fn()} />);
      expect(screen.queryByText('Opus 4.6')).not.toBeInTheDocument();
      expect(screen.queryByText('Sonnet 4.5')).not.toBeInTheDocument();
    });

    it('has aria-expanded=false when closed', () => {
      render(<ModelPicker value={DEFAULT_MODEL} onChange={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: /haiku 4.5/i }),
      ).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('opening the picker', () => {
    it('shows all model options after clicking the trigger', async () => {
      const user = userEvent.setup();
      render(<ModelPicker value={DEFAULT_MODEL} onChange={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /haiku 4.5/i }));
      for (const model of CLAUDE_MODELS) {
        // Use getAllByText because the selected model label appears in both the
        // trigger button and in the open dropdown list.
        expect(screen.getAllByText(model.label).length).toBeGreaterThan(0);
      }
    });

    it('shows model descriptions when open', async () => {
      const user = userEvent.setup();
      render(<ModelPicker value={DEFAULT_MODEL} onChange={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /haiku 4.5/i }));
      expect(
        screen.getByText('Most capable — best for complex tasks'),
      ).toBeInTheDocument();
    });

    it('marks the currently selected option as aria-selected=true', async () => {
      const user = userEvent.setup();
      render(<ModelPicker value="claude-opus-4-6" onChange={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /opus 4.6/i }));
      const opusOption = screen.getByRole('option', { name: /opus 4.6/i });
      expect(opusOption).toHaveAttribute('aria-selected', 'true');
    });

    it('marks non-selected options as aria-selected=false', async () => {
      const user = userEvent.setup();
      render(<ModelPicker value="claude-opus-4-6" onChange={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /opus 4.6/i }));
      const haikuOption = screen.getByRole('option', { name: /haiku 4.5/i });
      expect(haikuOption).toHaveAttribute('aria-selected', 'false');
    });

    it('sets aria-expanded=true on the trigger when open', async () => {
      const user = userEvent.setup();
      render(<ModelPicker value={DEFAULT_MODEL} onChange={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: /haiku 4.5/i });
      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('model selection', () => {
    it('calls onChange with the selected model id', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<ModelPicker value={DEFAULT_MODEL} onChange={onChange} />);
      await user.click(screen.getByRole('button', { name: /haiku 4.5/i }));
      await user.click(screen.getByRole('option', { name: /opus 4.6/i }));
      expect(onChange).toHaveBeenCalledWith('claude-opus-4-6');
    });

    it('calls onChange with Sonnet model id', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<ModelPicker value={DEFAULT_MODEL} onChange={onChange} />);
      await user.click(screen.getByRole('button', { name: /haiku 4.5/i }));
      await user.click(screen.getByRole('option', { name: /sonnet 4.5/i }));
      expect(onChange).toHaveBeenCalledWith('claude-sonnet-4-5-20250929');
    });

    it('closes the dropdown after selection', async () => {
      const user = userEvent.setup();
      render(<ModelPicker value={DEFAULT_MODEL} onChange={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /haiku 4.5/i }));
      await user.click(screen.getByRole('option', { name: /opus 4.6/i }));
      // After selection, the dropdown options should no longer be visible
      expect(
        screen.queryByRole('option', { name: /sonnet 4.5/i }),
      ).not.toBeInTheDocument();
    });

    it('toggles closed when trigger is clicked again', async () => {
      const user = userEvent.setup();
      render(<ModelPicker value={DEFAULT_MODEL} onChange={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: /haiku 4.5/i });
      await user.click(trigger); // open
      expect(
        screen.getByRole('option', { name: /opus 4.6/i }),
      ).toBeInTheDocument();
      await user.click(trigger); // close
      expect(
        screen.queryByRole('option', { name: /opus 4.6/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('applies extra className to the wrapper', () => {
      const { container } = render(
        <ModelPicker
          value={DEFAULT_MODEL}
          onChange={vi.fn()}
          className="my-custom-class"
        />,
      );
      expect((container.firstChild as HTMLElement).className).toContain(
        'my-custom-class',
      );
    });
  });
});
