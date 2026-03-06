import torch
import torch.nn as nn


class LSTMPredictor(nn.Module):
    """
    Direct multi-step LSTM: takes a sequence of INPUT_SEQ days and
    outputs OUTPUT_HORIZON × 2 (gas, pressure) in one forward pass.
    """

    def __init__(
        self,
        input_size: int,
        hidden_size: int = 64,
        num_layers: int = 2,
        output_horizon: int = 14,
        output_size: int = 2,
        dropout: float = 0.2,
    ):
        super().__init__()
        self.output_horizon = output_horizon
        self.output_size = output_size

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden_size, output_horizon * output_size)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        out = self.dropout(out[:, -1, :])
        out = self.fc(out)
        return out.view(-1, self.output_horizon, self.output_size)
