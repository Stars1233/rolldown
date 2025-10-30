use arcstr::ArcStr;
use oxc::span::Span;

use crate::{
  build_diagnostic::diagnostic::Diagnostic, types::diagnostic_options::DiagnosticOptions,
};

use super::BuildEvent;

#[derive(Debug)]
pub struct Eval {
  pub span: Span,
  pub source: ArcStr,
  pub filename: String,
}

impl BuildEvent for Eval {
  fn kind(&self) -> crate::types::event_kind::EventKind {
    crate::types::event_kind::EventKind::Eval
  }

  fn id(&self) -> Option<String> {
    Some(self.filename.clone())
  }

  fn message(&self, _opts: &DiagnosticOptions) -> String {
    format!(
      "Use of direct `eval` in '{}' is strongly discouraged as it poses security risks and may cause issues with minification.",
      self.filename
    )
  }

  fn on_diagnostic(&self, diagnostic: &mut Diagnostic, opts: &DiagnosticOptions) {
    let filename = opts.stabilize_path(&self.filename);
    let file_id = diagnostic.add_file(filename, self.source.clone());

    diagnostic.title = String::from(
      "Use of direct `eval` function is strongly discouraged as it poses security risks and may cause issues with minification.",
    );

    diagnostic.add_label(
      &file_id,
      self.span.start..self.span.end,
      String::from("Use of direct `eval` here."),
    );

    diagnostic.add_help(String::from("Consider using indirect eval. For more information, check the documentation: https://rolldown.rs/guide/troubleshooting#avoiding-direct-eval"));
  }
}
