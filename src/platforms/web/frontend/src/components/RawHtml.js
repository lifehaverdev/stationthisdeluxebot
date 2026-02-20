import { Component, h } from '@monygroupcorp/microact';

/**
 * Renders raw HTML string into a container element.
 * Props: { html: string, className?: string }
 */
export class RawHtml extends Component {
  constructor(props) {
    super(props);
    this.containerRef = null;
  }

  didMount() {
    this.inject();
  }

  didUpdate() {
    this.inject();
  }

  inject() {
    if (this.containerRef && this.props.html != null) {
      this.containerRef.innerHTML = this.props.html;
    }
  }

  shouldUpdate(oldProps, newProps) {
    return oldProps.html !== newProps.html;
  }

  render() {
    return h('div', {
      className: this.props.className || '',
      ref: (el) => { this.containerRef = el; }
    });
  }
}
